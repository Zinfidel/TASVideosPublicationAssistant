using System;
using System.Collections;
using System.Collections.Generic;
using System.Collections.Specialized;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Reflection;
using System.Security;
using System.Text.Json;
using System.Threading.Tasks;
using System.Web;

namespace TASVideosPublicationAssistant
{
    public static class InternetArchive
    {
        public const string UserQueryFormat = "https://archive.org/advancedsearch.php?q=uploader:{0}&fl[]=title&fl[]=identifier&sort[]=addeddate+desc&sort[]=&sort[]=&rows={1}&page=1&output=json";
        public const string GETMetadata = "https://archive.org/metadata/";
        public const string GETMetadataFilesFormat = "https://archive.org/metadata/{0}/files";
        public const string GETDownloadFormat = "https://archive.org/download/{0}/{1}";
        public const string POSTUniqueIdentifier = "https://archive.org/upload/app/upload_api.php";
        public const string PUTUploadFormat = "https://s3.us.archive.org/{0}/{1}";
        public const string POSTLogin = "https://archive.org/services/xauthn/";

        private static string? PublicKey;
        private static string? PrivateKey;

        public static Dictionary<string, string> GetDefaultCollections()
        {
            return new Dictionary<string, string>()
            {
                { "Community movies",   "opensource_movies" },
                { "Community audio",    "opensource_audio" },
                { "Community texts",    "opensource" },
                { "Community software", "open_source_software" },
                { "Community image",    "opensource_image" },
                { "Community data",     "opensource_media" }
            };
        }

        public static Dictionary<string, string> GetLicenses()
        {
            return new Dictionary<string, string>()
            {
                { "CC0",                                                    "http://creativecommons.org/publicdomain/zero/1.0/" },
                { "Public Domain",                                          "http://creativecommons.org/publicdomain/mark/1.0/" },
                { "Creative Commons Attribution-NonCommercial-ShareAlike",  "https://creativecommons.org/licenses/by-nc-sa/4.0/" },
                { "Creative Commons Attribution-NonCommercial",             "https://creativecommons.org/licenses/by-nc/4.0/" },
                { "Creative Commons Attribution-ShareAlike",                "https://creativecommons.org/licenses/by-sa/4.0/" },
                { "Creative Commons Attribution-Remix",                     "https://creativecommons.org/licenses/by/4.0/" },
                { "Creative Commons Attribution-NonCommercial-NoDerivs",    "https://creativecommons.org/licenses/by-nc-nd/4.0/" },
                { "Creative Commons Attribution-NoDerivs",                  "https://creativecommons.org/licenses/by-nd/4.0/" }
            };
        }

        public static OrderedDictionary GetLanguages()
        {
            var assembly = Assembly.GetExecutingAssembly();
            var resourceName = "TASVideosPublicationAssistant.Resources.lang_codes.txt";
            var ret = new OrderedDictionary();

            using (var stream = assembly.GetManifestResourceStream(resourceName)!)
            using (var reader = new StreamReader(stream))
            using (var sReader = new StringReader(reader.ReadToEnd()))
            {
                string? line;

                // Parse lines of form "id urlEncodedName" into <urlEncodedName, id> pairs. Skip -obsolete lines.
                while ((line = sReader.ReadLine()) != null)
                {
                    int firstSpace = line.IndexOf('\t');
                    string id = line.Remove(firstSpace);
                    string name = HttpUtility.HtmlDecode(line[(firstSpace + 1)..]);
                    if (id[0] != '-')
                        ret[name] = id;
                }
            }

            return ret;
        }

        /// <summary>Log in with username/pw credentials to retrieve public/private key for uploading.</summary>
        /// <exception cref="Exception">If the log-in attempt fails due to normal reasons (wrong password, etc.).</exception>
        /// <exception cref="HttpRequestException">If something's wrong with the request or parsing.</exception>
        public static async Task LogIn(HttpClient client, string email, SecureString password)
        {
            if (PublicKey != null && PrivateKey != null)
                return;

            var ops = new Dictionary<string, string>()
            {
                { "op", "login" }
            };

            FormUrlEncodedContent encodedContent = password.UseDecryptedSecureString(pwd =>
            {
                var content = new Dictionary<string, string>()
                {
                    { "email", email },
                    { "password", pwd }
                }
                .Select(c => new KeyValuePair<string?, string?>(c.Key, c.Value));

                return new FormUrlEncodedContent(content);
            });

            var query = new Uri(BuildPostQuery(POSTLogin, ops));

            var response = await client.PostAsync(query, encodedContent);
            response.EnsureSuccessStatusCode();
            var responseData = response.Content.ReadAsStringAsync().Result;

            var responseJson = JsonDocument.Parse(responseData);
            var login = JsonSerializer.Deserialize<IALoginResponse>(responseJson.RootElement.GetRawText());

            if (login is null)
                throw new HttpRequestException("Could not deserialize login response.");

            if (!login.success)
                throw new Exception("Internet Archive log-in attempt failed.");

            PublicKey = login.AccessKey;
            PrivateKey = login.SecretKey;
        }

        public static string BuildPostQuery(string url, Dictionary<string, string> qParams)
        {
            return url + $"?{string.Join("&", qParams.Select(pair => $"{HttpUtility.UrlEncode(pair.Key)}={HttpUtility.UrlEncode(pair.Value)}"))}";
        }

        /// <summary>Check with IA if an ID is available, and if not, get a suggestion.</summary>
        /// <returns>The supplied ID if it's valid, or the ID suggested by IA if not.</returns>
        /// <exception cref="HttpRequestException">If something's wrong with the request or parsing.</exception>
        public static async Task<string> GetIdentifier(HttpClient client, string id)
        {
            var api = new Uri(POSTUniqueIdentifier);

            var content = new Dictionary<string, string>()
            {
                { "name", "identifierAvailable" },
                { "identifier", id },
                { "findUnique", "true" }
            };

            using HttpResponseMessage response = await client.PostAsync(api, new FormUrlEncodedContent(content!));
            response.EnsureSuccessStatusCode();

            var responseData = response.Content.ReadAsStringAsync().Result;
            var responseJson = JsonDocument.Parse(responseData);
            var uniqueID = JsonSerializer.Deserialize<IAUniqueIDCheck>(responseJson.RootElement.GetRawText());

            if (uniqueID is null)
                throw new HttpRequestException("Could not deserialize identifier request response.");

            if (uniqueID.success)
                Trace.TraceInformation($"Identifier {id} is available.");
            else
                Trace.TraceWarning($"Identifier {id} is not available. Archive.org suggests {uniqueID.identifier}.");

            return uniqueID.success ? uniqueID.identifier : id;
        }

        /// <summary>Retrieve a metadata listing of all files for an IA entry.</summary>
        /// <returns>All files URLs for an IA entry, with the source property available.</returns>
        /// <exception cref="HttpRequestException">If something is wrong with the request or the parsing.</exception>
        public static async Task<IAFile[]> GetFilesMetadata(HttpClient client, string itemId)
        {
            using HttpResponseMessage response = await client.GetAsync(string.Format(GETMetadataFilesFormat, itemId));
            response.EnsureSuccessStatusCode();

            string responseData = response.Content.ReadAsStringAsync().Result;
            var responseJson = JsonDocument.Parse(responseData);
            var results = responseJson.RootElement.GetProperty("result").GetRawText();
            var json = JsonSerializer.Deserialize<IAFile[]>(results);

            if (json is null)
                throw new HttpRequestException("Could not deserialize files metadata.");

            return json;
        }

        /// <summary>Search IA for recent uploads for a certain email.</summary>
        /// <param name="email">User's email (not username!).</param>
        /// <param name="resultsCount">The number of results form most recent back to retrieve.</param>
        /// <returns>IDs for recent uploads.</returns>
        /// <exception cref="HttpRequestException">If something is wrong with the request or the parsing.</exception>
        public static async Task<IADocument[]> SearchUploadsByEmail(HttpClient client, string email, int resultsCount = 5)
        {
            string userQuery = Uri.EscapeUriString(string.Format(UserQueryFormat, email, resultsCount));
            using HttpResponseMessage response = await client.GetAsync(userQuery);
            response.EnsureSuccessStatusCode();

            var queryResponse = response.Content.ReadAsStringAsync().Result;
            var doc = JsonDocument.Parse(queryResponse);
            var responseNode = doc.RootElement.GetProperty("response");
            var searchResponse = JsonSerializer.Deserialize<IASearchResponse>(responseNode.GetRawText());

            if (searchResponse?.docs is null)
                throw new HttpRequestException("Could not deserialize search results.");

            return searchResponse.docs;
        }

        public static async Task Upload(HttpClient client, IProgress<double> progress, UploadInfo info, params string[] files)
        {
            const long bytesToMegabytes = 1048576;

            if (string.IsNullOrEmpty(PublicKey) || string.IsNullOrEmpty(PrivateKey))
                throw new Exception("Public/private key not acquired before constructing upload requests.");

            files = files.Where(f => !string.IsNullOrWhiteSpace(f)).ToArray();

            if (files.Length == 0)
                throw new Exception("At least one file must be supplied.");

            var requests = new List<HttpRequestMessage>();
            var progresses = new Dictionary<string, long>();
            var fileSizes = files.ToDictionary(f => f, f => new FileInfo(f).Length);
            long totalSize = fileSizes.Values.Sum();

            try
            {
                // Construct trackable upload requests
                foreach (string file in files)
                {
                    var fileProgress = new Progress<long>(p =>
                    {
                        progresses[file] = p;
                        progress.Report((double)progresses.Values.Sum() / totalSize);
                        long size = fileSizes[file];
                        Web.TraceHttp($"Uploading {Path.GetFileName(file)}: {p / bytesToMegabytes}/{size / bytesToMegabytes} MB ({(p*100)/size}%)");
                    });
                    requests.Add(GetUploadRequest(file, fileProgress, info));
                }

                // Size hint for the entire IA item
                foreach (var request in requests)
                    request.Headers.Add("x-archive-size-hint", totalSize.ToString());

                // For multiple uploads, skip derive on first upload
                if (requests.Count > 1)
                    requests.First().Headers.Add("x-archive-queue-derive", "0");

                foreach (var request in requests)
                {
                    var response = await client.SendAsync(request, HttpCompletionOption.ResponseHeadersRead);
                    response.EnsureSuccessStatusCode();
                }
            }
            finally
            {
                requests.ForEach(r => r.Dispose());
            }
        }

        private static HttpRequestMessage GetUploadRequest(string file, Progress<long> progress, UploadInfo info)
        {
            const string mp4Type = "video/mp4";
            const string mkvType = "video/x-matroska";

            var fileStream = new FileStream(file, FileMode.Open);
            var content = new ProgressableStreamContent(new StreamContent(fileStream), progress);
            content.Headers.ContentType = new MediaTypeHeaderValue(file.EndsWith("mp4") ? mp4Type : mkvType);

            string uploadEndpoint = string.Format(PUTUploadFormat, info.Id, Path.GetFileName(file));
            var request = new HttpRequestMessage(HttpMethod.Put, uploadEndpoint) { Content = content };

            request.Headers.Authorization = null;
            request.Headers.Add("authorization", $"LOW {PublicKey}:{PrivateKey}");

            request.Headers.Connection.Add("keep-alive");
            request.Headers.ExpectContinue = true;
            request.Headers.CacheControl = new CacheControlHeaderValue() { NoCache = true };

            foreach (var header in info)
                request.Headers.Add(header.Key, header.Value);

            return request;
        }

        public sealed class UploadInfo : IEnumerable<KeyValuePair<string, string>>
        {
            private readonly Dictionary<string, string> headers = new()
            {
                { "x-amz-acl",                  "bucket-owner-full-control" }, // Technically deprecated, but web uploader sets it.
                { "x-amz-auto-make-bucket",     "1" },                         // Combination upload-and-make-page option.
                { "x-archive-meta-mediatype",   "movies" }                     // Separate from collections header.
            };

            public string Id
            {
                get => headers["x-archive-meta-title"];
                set => headers["x-archive-meta-title"] = value;
            }

            public string   Email           { set => headers["x-archive-meta-uploader"] = value; }
            public string   Description     { set => headers["x-archive-meta-description"] = value; }
            public string   Creator         { set => headers["x-archive-meta-creator"] = value; }
            public DateTime Date            { set => headers["x-archive-meta-date"] = value.ToString("yyyy-MM-dd"); }
            public string   Collection      { set => headers["x-archive-meta-collection"] = value; }
            public string   Language        { set => headers["x-archive-meta-language"] = value; }
            public string   License         { set => headers["x-archive-meta-licenseurl"] = value; }

            public IEnumerable<string> Tags
            {
                set
                {
                    int i = 1;
                    foreach (string tag in value)
                    {
                        headers[$"x-archive-meta{i++:D2}-subject"] = tag;
                    }
                }
            }

            public IEnumerator<KeyValuePair<string, string>> GetEnumerator() => headers.GetEnumerator();
            IEnumerator IEnumerable.GetEnumerator() => GetEnumerator();
        }
    }

#pragma warning disable IDE1006, CS8618 // Serialization classes

    public class IASearchResponse
    {
        public int numFound { get; set; }
        public int start { get; set; }
        public IADocument[] docs { get; set; }
    }

    public class IADocument
    {
        public string identifier { get; set; }
        public string title { get; set; }

        public override string ToString() => title;
    }

    public class IAFile
    {
        public string name { get; set; }
        public string source { get; set; }
    }

    public class IAUniqueIDCheck
    {
        public string identifier { get; set; }
        public bool success { get; set; }
    }

    public class IALoginResponse
    {
        public bool success { get; set; }
        public IALoginResponseValues values { get; set; }

        public string AccessKey => values.s3["access"];
        public string SecretKey => values.s3["secret"];

        public class IALoginResponseValues
        {
            public Dictionary<string, string> cookies { get; set; }
            public string email { get; set; }
            public string itemname { get; set; }
            public Dictionary<string, string> s3 { get; set; }
            public string screenname { get; set; }
        }
    }

#pragma warning restore IDE1006, CS8618
}
