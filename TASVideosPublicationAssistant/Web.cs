using System;
using System.Diagnostics;
using System.IO;
using System.Net;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Reflection;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using TASVideosPublicationAssistant.Resources;

#if DEBUG
using RichardSzalay.MockHttp;
#endif

namespace TASVideosPublicationAssistant
{
    public static class Web
    {
        public static HttpClient GetHttpClient()
        {
#if DEBUG
            return GetMockClient();
            //return ConfigureHttpClient();
#else
            return ConfigureHttpClient();
#endif
        }

        private static HttpClient ConfigureHttpClient()
        {
            var innerHandler = new HttpClientHandler()
            {
                AllowAutoRedirect = true,
                AutomaticDecompression = DecompressionMethods.Deflate | DecompressionMethods.GZip | DecompressionMethods.Brotli,
                UseCookies = false,
            };

#if DEBUG
            // For HTTP interception tools
            innerHandler.ServerCertificateCustomValidationCallback = HttpClientHandler.DangerousAcceptAnyServerCertificateValidator;
#endif

            var loggingHandler = new HttpMessageLogger(innerHandler);
            var client = new HttpClient(loggingHandler, true);

            client.DefaultRequestHeaders.Accept.Add(new MediaTypeWithQualityHeaderValue("*/*"));
            client.DefaultRequestHeaders.AcceptLanguage.Add(new StringWithQualityHeaderValue("en-US"));
            client.DefaultRequestHeaders.AcceptLanguage.Add(new StringWithQualityHeaderValue("en", 0.9));
            client.Timeout = Timeout.InfiniteTimeSpan; // Very important for large uploads!

            var assemName = Assembly.GetExecutingAssembly().GetName();
            client.DefaultRequestHeaders.UserAgent.Add(new ProductInfoHeaderValue(assemName.Name!, assemName.Version!.ToString()));

            return client;
        }

        public static void TraceHttp(string message)
        {
            Trace.Write("Trace Http: ");
            Trace.WriteLine(message);
        }

#if DEBUG
        private static HttpClient GetMockClient()
        {
            const string JsonContentType = "application/json";
            const string HtmlContentType = "text/html";

            var mockHandler = new MockHttpMessageHandler();
            mockHandler.Fallback.Throw(new Exception("No canned response."));

            // Recent pages query
            string userQuery = Uri.EscapeUriString(string.Format(InternetArchive.UserQueryFormat, "email@gmail.com", 5));
            mockHandler.When(userQuery).Respond((request) => Delay(request, JsonContentType, MockData.UserQueryResponse));

            // Metafiles query
            mockHandler.When(MockData.MetadataFiles0Query).Respond((request) => Delay(request, JsonContentType, MockData.MetadataFiles0Response));
            mockHandler.When(MockData.MetadataFiles1Query).Respond((request) => Delay(request, JsonContentType, MockData.MetadataFiles1Response));
            mockHandler.When(MockData.MetadataFiles2Query).Respond((request) => Delay(request, JsonContentType, MockData.MetadataFiles2Response));
            mockHandler.When(MockData.MetadataFiles3Query).Respond((request) => Delay(request, JsonContentType, MockData.MetadataFiles3Response));
            mockHandler.When(MockData.MetadataFiles4Query).Respond((request) => Delay(request, JsonContentType, MockData.MetadataFiles4Response));

            // Submission query
            mockHandler.When(MockData.SubmissionQuery).Respond((request) => Delay(request, HtmlContentType, MockData.SubmissionResponse));
            mockHandler.When(MockData.SubmissionQueryFail).Respond((request) => Delay(request, HtmlContentType, MockData.SubmissionResponseFail));

            // Unique identifier query
            mockHandler.When(InternetArchive.POSTUniqueIdentifier).WithPartialContent("identifier=test-good")
                .Respond((request) => Delay(request, JsonContentType, "{\"success\": true, \"identifier\": \"test-good\"}"));

            mockHandler.When(InternetArchive.POSTUniqueIdentifier).WithPartialContent("identifier=test-bad")
                .Respond((request) => Delay(request, JsonContentType, "{\"success\": true, \"identifier\": \"test-suggested-good\"}"));

            // Upload request
            mockHandler.When(string.Format(InternetArchive.PUTUploadFormat, "*", "*")).Respond(async (request) =>
            {
                await request.Content!.ReadAsByteArrayAsync();
                var response = new HttpResponseMessage(HttpStatusCode.OK);
                response.Headers.ConnectionClose = true;
                return response;
            });

            // Log-in request
            mockHandler.When(InternetArchive.POSTLogin + "*").Respond((request) => Delay(request, JsonContentType, MockData.LoginResponse));

            return new HttpClient(new HttpMessageLogger(mockHandler));
        }

        private async static Task<HttpResponseMessage> Delay(HttpRequestMessage request, string type, string data)
        {
            const int delay = 3000;
            var content = new StringContent(data, Encoding.UTF8, type);
            await Task.Delay(delay);
            return new HttpResponseMessage(HttpStatusCode.OK) { Content = content };
        }
#endif
    }

    public class ProgressableStreamContent : HttpContent
    {
        private const int defaultBufferSize = 1024 * 1024; // 1MB

        private readonly StreamContent content;
        private readonly int bufferSize;
        private readonly IProgress<long> progress;

        public ProgressableStreamContent(StreamContent content, IProgress<long> progress) : this(content, defaultBufferSize, progress)
        {
        }

        public ProgressableStreamContent(StreamContent content, int bufferSize, IProgress<long> progress)
        {
            if (content is null)
                throw new ArgumentNullException(nameof(content));

            if (bufferSize <= 0)
                throw new ArgumentOutOfRangeException(nameof(bufferSize));

            this.content = content;
            this.bufferSize = bufferSize;
            this.progress = progress;

            foreach (var h in content.Headers)
                Headers.Add(h.Key, h.Value);
        }

        /// <summary>Trackable (reports progress) customization of standard StreamContent.</summary>
        protected override async Task SerializeToStreamAsync(Stream stream, TransportContext? context)
        {
            const double updateInterval = 0.1;

            var buffer = new byte[bufferSize];
            long uploaded = 0;
            long lastUpdate = 0;

            using var contentStream = await content.ReadAsStreamAsync();
            long updateIntervalSize = (long)(contentStream.Length * updateInterval);

            progress.Report(0); // Connection established indicator
            while (true)
            {
                int length = await contentStream.ReadAsync(buffer);
                if (length <= 0) break;

                // Report only so often based on an interval.
                uploaded += length;
                if ((uploaded - lastUpdate) >= updateIntervalSize)
                {
                    progress.Report(uploaded);
                    lastUpdate = uploaded;
                }

                await stream.WriteAsync(buffer, 0, length);
                await stream.FlushAsync();
            }

            progress.Report(uploaded); // Finished indicator
            stream.Flush();
        }

        protected override bool TryComputeLength(out long length)
        {
            length = content.Headers.ContentLength.GetValueOrDefault();
            return true;
        }

        protected override void Dispose(bool disposing)
        {
            if (disposing)
            {
                content.Dispose();
            }
            base.Dispose(disposing);
        }

    }

    public class HttpMessageLogger : MessageProcessingHandler
    {
        public HttpMessageLogger(HttpMessageHandler innerHandler) : base(innerHandler)
        {
        }

        protected override HttpRequestMessage ProcessRequest(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            Web.TraceHttp($"Request: {request.Method} {request.RequestUri}");

#if false
            if (request.Headers.Any())
            {
                Debug.WriteLine("\t[REQUEST HEADERS]");
                foreach (var header in request.Headers)
                    Debug.WriteLine($"\t{header.Key}: {string.Join(',', header.Value)}");
            }
#endif

            return request;
        }

        protected override HttpResponseMessage ProcessResponse(HttpResponseMessage response, CancellationToken cancellationToken)
        {
            string msg = $"Response: {response.ReasonPhrase}";
            string msgType = response.Content.Headers?.ContentType?.ToString() ?? string.Empty;
            if (!string.IsNullOrWhiteSpace(msgType))
                msg += $", Content: {msgType}";

            Web.TraceHttp(msg);

#if false
            if (response.Headers.Any())
            {
                Debug.WriteLine("\t[RESPONSE HEADERS]");
                foreach (var header in response.Headers)
                    Debug.WriteLine($"\t{header.Key}: {string.Join(',', header.Value)}");
            }

            if (response.Content.Headers.Any())
            {
                Debug.WriteLine("\t[RESPONSE CONTENT HEADERS]");
                foreach (var header in response.Content.Headers)
                    Debug.WriteLine($"\t{header.Key}: {string.Join(',', header.Value)}");
            }
#endif

            return response;
        }
    }
}
