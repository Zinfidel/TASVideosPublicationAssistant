using AdonisUI.Controls;
using Net.Torrent;
using Net.Torrent.BEncode;
using System;
using System.Collections.Generic;
using System.Collections.Specialized;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Net.Http;
using System.Security;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading.Tasks;
using System.Xml.Linq;
using TASVideosPublicationAssistant.Properties;
using Res = TASVideosPublicationAssistant.Resources.Resources;

namespace TASVideosPublicationAssistant
{
    public partial class MainViewModel
    {
        private readonly Dictionary<string, IAFile[]> SearchResultFilesCache;

        private HttpClient? _client;
        private HttpClient Client => _client ??= Web.GetHttpClient();

        public Func<SecureString>? GetSecurePassword;
        public Action<SecureString>? SetSecurePassword;

        #region Properties.Common

        private string _archiveEmail = string.Empty;
        public string ArchiveEmail
        {
            get => _archiveEmail;
            set => Set(ref _archiveEmail, value, true);
        }

        private string _modernEncodePath = string.Empty;
        public string ModernEncodePath
        {
            get => _modernEncodePath;
            set
            {
                Set(ref _modernEncodePath, value, true);
                if (!string.IsNullOrWhiteSpace(value))
                {
                    if (File.Exists(value))
                    {
                        PageID = Path.GetFileNameWithoutExtension(value);
                        ModernTorrentPath = value + ".torrent";
                    }
                    else
                    {
                        SetError("This is not a valid path to a file.");
                    }
                }
            }
        }

        private string _compatabilityEncodePath = string.Empty;
        public string CompatabilityEncodePath
        {
            get => _compatabilityEncodePath;
            set
            {
                Set(ref _compatabilityEncodePath, value, true);
                if (!string.IsNullOrWhiteSpace(value))
                {
                    if (File.Exists(value))
                    {
                        if (string.IsNullOrWhiteSpace(ModernEncodePath))
                        {
                            string id = value;
                            int index = value.IndexOf("_512kb", StringComparison.CurrentCultureIgnoreCase);
                            if (index > -1)
                                id = value.Remove(index);

                            PageID = Path.GetFileNameWithoutExtension(id);
                        }

                        CompatabilityTorrentPath = value + ".torrent";
                    }
                    else
                    {
                        SetError("This is not a valid path to a file.");
                    }
                }
            }
        }

        #endregion

        #region Properties.Upload

        private string pageID = string.Empty;
        public string PageID
        {
            get => pageID;
            set
            {
                Set(ref pageID, value);
                PageTitle = value;
                OnPropertyChanged(nameof(IsPageIDValid));
            }
        }

        private string _pageTitle = string.Empty;
        public string PageTitle
        {
            get => _pageTitle;
            set => Set(ref _pageTitle, value, true);
        }


        private string _lastGoodID = string.Empty;
        public string LastGoodID
        {
            get => _lastGoodID;
            set
            {
                _lastGoodID = value;
                OnPropertyChanged(nameof(IsPageIDValid));
            }
        }

        public bool IsPageIDValid => !string.IsNullOrWhiteSpace(LastGoodID) && pageID == LastGoodID;

        private string _description = string.Empty;
        public string Description
        {
            get => _description;
            set => Set(ref _description, value, true);
        }

        private string _tags = Settings.Default.Tags;
        public string Tags
        {
            get => _tags;
            set
            {
                Set(ref _tags, value);

                if (value.Split(',').Length > 10)
                    SetError("Tag list can be no longer than 10 tags.");
                else
                    ClearErrors();
            }
        }

        private string _Creator = string.Empty;
        public string Creator
        {
            get => _Creator;
            set => Set(ref _Creator, value, true);
        }

        private DateTime _date = DateTime.Now;
        public DateTime Date
        {
            get => _date;
            set => Set(ref _date, value);
        }

        public Dictionary<string, string> Collections { get; }

        private string _selectedCollection;
        public string SelectedCollection
        {
            get => _selectedCollection;
            set => Set(ref _selectedCollection, value);
        }

        private bool _TestItem = false;
        public bool TestItem
        {
            get => _TestItem;
            set => Set(ref _TestItem, value);
        }

        public OrderedDictionary Languages { get; }

        private string _selectedLanguage;
        public string SelectedLanguage
        {
            get => _selectedLanguage;
            set => Set(ref _selectedLanguage, value);
        }

        public Dictionary<string, string> Licenses { get; }

        private string _selectedLicense;
        public string SelectedLicense
        {
            get => _selectedLicense;
            set => Set(ref _selectedLicense, value);
        }

        private int _loadingUploadSemaphore;
        public bool LoadingUpload
        {
            get => _loadingUploadSemaphore > 0;
            set
            {
                Set(ref _loadingUploadSemaphore, _loadingUploadSemaphore + (value ? 1 : -1));
                if (!LoadingUpload)
                    LoadingUploadProgress = 0.0; // Reset to indeterminate any time loading is turned off
            }
        }

        private double _loadingUploadProgress = 0.0;
        public double LoadingUploadProgress
        {
            get => _loadingUploadProgress;
            set => Set(ref _loadingUploadProgress, value);
        }

        #endregion

        #region Properties.Videos

        private string _modernEncodeUrl = string.Empty;
        public string ModernEncodeUrl
        {
            get => _modernEncodeUrl;
            set => Set(ref _modernEncodeUrl, value);
        }

        private string _compatabilityEncodeUrl = string.Empty;
        public string CompatabilityEncodeUrl
        {
            get => _compatabilityEncodeUrl;
            set => Set(ref _compatabilityEncodeUrl, value);
        }

        public IADocument[]? _SearchResults;
        public IADocument[]? SearchResults
        {
            get => _SearchResults;
            set
            {
                Set(ref _SearchResults, value);
                SelectedSearchResult = value?.Length >= 1 ? value[0] : null;
            }
        }

        public IADocument? _selectedSearchResult;
        public IADocument? SelectedSearchResult
        {
            get => _selectedSearchResult;
            set
            {
                Set(ref _selectedSearchResult, value);

                if (value != null)
                    LoadSearchResult(value.identifier);
            }
        }

        private int _loadingVideosSemaphore;
        public bool LoadingVideos
        {
            get => _loadingVideosSemaphore > 0;
            set => Set(ref _loadingVideosSemaphore, _loadingVideosSemaphore + (value ? 1 : -1));
        }

        #endregion

        #region Properties.Torrent

        private string _modernTorrentPath = string.Empty;
        public string ModernTorrentPath
        {
            get => _modernTorrentPath;
            set => Set(ref _modernTorrentPath, value);
        }

        private string _compatabilityTorrentPath = string.Empty;
        public string CompatabilityTorrentPath
        {
            get => _compatabilityTorrentPath;
            set => Set(ref _compatabilityTorrentPath, value);
        }

        public bool ModernTorrentPathsValid
        {
            get
            {
                // Piggyback validation of encode paths
                bool pathIsGood = !string.IsNullOrWhiteSpace(ModernEncodePath) && !GetErrors(nameof(ModernEncodePath)).OfType<string>().Any();
                bool urlIsGood = !string.IsNullOrWhiteSpace(ModernEncodeUrl);
                return pathIsGood && urlIsGood;
            }
        }

        public bool CompatabilityTorrentPathsValid
        {
            get
            {
                // Piggyback validation of encode paths
                bool pathIsGood = !string.IsNullOrWhiteSpace(CompatabilityEncodePath) && !GetErrors(nameof(CompatabilityEncodePath)).OfType<string>().Any();
                bool urlIsGood = !string.IsNullOrWhiteSpace(CompatabilityEncodeUrl);
                return pathIsGood && urlIsGood;
            }
        }

        private int _loadingTorrentsSemaphore;
        public bool LoadingTorrents
        {
            get => _loadingTorrentsSemaphore > 0;
            set => Set(ref _loadingTorrentsSemaphore, _loadingTorrentsSemaphore + (value ? 1 : -1));
        }

        #endregion

        public MainViewModel()
        {
            SearchResultFilesCache = new Dictionary<string, IAFile[]>();
            Collections = InternetArchive.GetDefaultCollections();
            _selectedCollection = "Community movies";

            Licenses = InternetArchive.GetLicenses();
            _selectedLicense = "Creative Commons Attribution-Remix";

            Languages = InternetArchive.GetLanguages();
            _selectedLanguage = "English";
        }

        public async Task GetUniqueIdentifier()
        {
            if (string.IsNullOrWhiteSpace(PageID))
                return;

            try
            {
                LoadingUpload = true;

                Trace.TraceInformation($"Checking if identifier \"{PageID}\" is available on Archive.org...");

                PageID = await InternetArchive.GetIdentifier(Client, PageID);

                LastGoodID = PageID;
                ClearErrors(nameof(PageID));
            }
            catch (Exception ex)
            {
                string msg = $"Could check for available identifiers on Internet Archive: {ex.Message}";
                Trace.TraceError(msg);
                MessageBox.Show(msg, Res.ErrorMessageCaption, icon: MessageBoxImage.Error);
            }
            finally
            {
                LoadingUpload = false;
            }
        }

        private void ValidateUpload()
        {
            // These are all "one-off" errors that can be cleared by just typing something into the offending fields.

            if (string.IsNullOrWhiteSpace(ArchiveEmail))
                SetError("A valid email address is required.", nameof(ArchiveEmail));

            if (string.IsNullOrWhiteSpace(ModernEncodePath) && string.IsNullOrWhiteSpace(CompatabilityEncodePath))
                SetError("At least one file must be available for upload.", nameof(ModernEncodePath));

            if (!IsPageIDValid)
                SetError("Validate the ID before uploading.", nameof(PageID));

            if (string.IsNullOrWhiteSpace(PageTitle))
                SetError("Enter a valid page title.", nameof(PageTitle));

            if (!Uri.TryCreate(Description, UriKind.Absolute, out _))
                SetError("Must be a valid URL (to the submission page).", nameof(Description));

            if (string.IsNullOrWhiteSpace(Creator))
                SetError("Enter a valid name.", nameof(Creator));
        }

        public async Task Upload()
        {
            ValidateUpload();
            if (HasErrors)
                return;

            // Log-in
            try
            {
                LoadingUpload = true;
                Trace.TraceInformation("Logging in to Internet Archive to get public/private keys...");
                await InternetArchive.LogIn(Client, ArchiveEmail, GetSecurePassword!());
                Trace.TraceInformation("Successfully retrieved public/private keys.");
            }
            catch (Exception ex)
            {
                string msg = $"Failed to log in to Internet Archive: {ex.Message}";
                Trace.TraceError(msg);
                MessageBox.Show(msg, Res.ErrorMessageCaption, icon: MessageBoxImage.Error);
                return;
            }
            finally
            {
                LoadingUpload = false;
            }

            // Upload
            try
            {
                LoadingUpload = true;
                var progress = new Progress<double>(p => LoadingUploadProgress = p);

                var info = new InternetArchive.UploadInfo()
                {
                    Collection = Collections[SelectedCollection],
                    Creator = this.Creator,
                    Date = this.Date,
                    Description = this.Description,
                    Email = ArchiveEmail,
                    Id = PageID,
                    Language = (string)Languages[SelectedLanguage]!,
                    License = Licenses[SelectedLicense],
                    Tags = this.Tags.Split(',').Select(t => t.Trim())
                };

                Trace.TraceInformation($"Beginning upload of files to IA page with ID: {info.Id}");
                await InternetArchive.Upload(Client, progress, info, CompatabilityEncodePath, ModernEncodePath);
                Trace.TraceInformation("Successfully uploaded files. The page should be available shortly.");

                LastGoodID = string.Empty; // Prevent immediate re-upload
            }
            catch (Exception ex)
            {
                string msg = $"Uploading has failed: {ex.Message}";
                Trace.TraceError(msg);
                MessageBox.Show(msg, Res.ErrorMessageCaption, icon: MessageBoxImage.Error);
            }
            finally
            {
                LoadingUpload = false;
            }
        }

        public async Task GetSubmissionProperties()
        {
            string pageUrl = Description;

            // User can just type the submission number with optional 's'. Turn this into a full url if that's what happened.
            if (Regex.IsMatch(pageUrl, @"^\d+[sS]?$"))
            {
                pageUrl = !pageUrl.EndsWith("s", StringComparison.OrdinalIgnoreCase) ? pageUrl + "S" : pageUrl.ToUpperInvariant();
                pageUrl = "http://tasvideos.org/" + pageUrl + ".html";
                Description = pageUrl;
            }

            if (!Uri.TryCreate(pageUrl, UriKind.Absolute, out Uri? result))
            {
                SetError("Enter a valid URL, or a submission number optionally followed by an 'S'.", nameof(Description));
                return;
            }

            try
            {
                LoadingUpload = true;
                Trace.TraceInformation($"Attempting to retrieve submission information from {Description}...");

                HttpResponseMessage response = await Client.GetAsync(result);
                response.EnsureSuccessStatusCode();
                var content = await response.Content.ReadAsStringAsync();

                Trace.TraceInformation("Submission page exists and was retrieved. Parsing...");

                // Old site doesn't have an opening <head> tag lol so add one to make it valid XHTML
                int index = content.IndexOf("<meta");
                var sb = new StringBuilder(content.Remove(index));
                sb.Append("<head>");
                sb.Append(content.Substring(index));
                content = sb.ToString();

                // Parse out the submission info table and grab the submitter and date cells.
                XNamespace ns = "http://www.w3.org/1999/xhtml";
                XDocument doc = XDocument.Load(new StringReader(content));
                var subInfo = doc.Root!.Descendants(ns + "div").Single(div => div.HasAttributes && div.Attribute("id")?.Value == "submission_info");
                var rows = subInfo.Descendants(ns + "tr").Where(d => d.Elements().First().Name == ns + "th");
                var props = rows.ToDictionary(k => k.Elements().First().Value.Trim(), v => v.Elements().Last().Value.Trim());

                Trace.TraceInformation("Parsing successful. Setting submission properties.");

                Creator = props["Author's nickname:"];
                Date = DateTime.Parse(props["Submitted at:"]);
            }
            catch (Exception ex)
            {
                string msg = $"Couldn't retrieve submission information: {ex.Message}";
                Trace.TraceError(msg);
                MessageBox.Show(msg, Res.ErrorMessageCaption, icon: MessageBoxImage.Error);
            }
            finally
            {
                LoadingUpload = false;
            }
        }

        public async Task SearchRecentIAUploads()
        {
            if (string.IsNullOrEmpty(ArchiveEmail))
            {
                SetError("A valid email address is required.", nameof(ArchiveEmail));
                return;
            }

            try
            {
                LoadingVideos = true;

                Trace.TraceInformation($"Searching for recent uploads on Internet Archive by {ArchiveEmail}");
                var results = await InternetArchive.SearchUploadsByEmail(Client, ArchiveEmail);
                Trace.TraceInformation($"Retrieved {results.Length} results.");

                SearchResults = results; // Fires its own loading process
            }
            catch (Exception ex)
            {
                string msg = $"Failed to retrieve recent uploads for {ArchiveEmail} from Internet Archive: {ex.Message}";
                Trace.TraceError(msg);
                MessageBox.Show(msg, Res.ErrorMessageCaption, icon: MessageBoxImage.Error);
            }
            finally
            {
                LoadingVideos = false;
            }
        }

        private async void LoadSearchResult(string id)
        {
            if (SelectedSearchResult is null)
                return;

            Trace.TraceInformation($"Retrieving Internet Archive metadata for {id}...");

            try
            {
                LoadingVideos = true;

                // Look for a cached result before sending an HTTP request.
                if (!SearchResultFilesCache.TryGetValue(id, out IAFile[]? files))
                    files = await InternetArchive.GetFilesMetadata(Client, id);

                Trace.TraceInformation($"Found {files.Length} metadata files.");

                if (files.Length == 0)
                    return;

                SearchResultFilesCache[id] = files;

                // Filtering metadata by source == original gets us just files that were actually uploaded, not derived.
                var sourceFiles = files.Where(t => t.source == "original");

                string? url = sourceFiles?.FirstOrDefault(t => t.name.EndsWith(".mkv"))?.name;
                ModernEncodeUrl = url != null ? string.Format(InternetArchive.GETDownloadFormat, id, url) : string.Empty;

                url = sourceFiles?.FirstOrDefault(t => t.name.EndsWith("_512kb.mp4"))?.name;
                CompatabilityEncodeUrl = url != null ? string.Format(InternetArchive.GETDownloadFormat, id, url) : string.Empty;
            }
            catch (Exception ex)
            {
                string msg = $"Couldn't retrieve Internet Archive video links: {ex.Message}";
                Trace.TraceError(msg);
                MessageBox.Show(msg, Res.ErrorMessageCaption, icon: MessageBoxImage.Error);
            }
            finally
            {
                LoadingVideos = false;
            }
        }

        public async Task BuildTorrents()
        {
            const string announce = "http://tracker.tasvideos.org:6969/announce";
            const uint pieceLength = 262144; // standard

            List<Tuple<FileInfo, string, string>> components = new();
            if (ModernTorrentPathsValid)
                components.Add(Tuple.Create(new FileInfo(ModernEncodePath), ModernEncodeUrl, ModernTorrentPath));
            if (CompatabilityTorrentPathsValid)
                components.Add(Tuple.Create(new FileInfo(CompatabilityEncodePath), CompatabilityEncodeUrl, CompatabilityTorrentPath));

            if (components.Count == 0)
            {
                Trace.TraceError("Building torrents failed - there must be at least one encode and url available.");
                return;
            }

            try
            {
                LoadingTorrents = true;

                foreach (var component in components)
                {
                    Trace.TraceInformation($"Building torrent for {component.Item1.Name}");

                    await Task.Run(() =>
                    {
                        var builder = new TorrentBuilder(Encoding.UTF8);
                        builder.SetPieceLength(pieceLength);
                        builder.SetAnnounce(new Uri(announce));
                        builder.SetExtension(new BString("creation date", Encoding.UTF8), new BNumber(DateTimeOffset.UtcNow.ToUnixTimeSeconds()));

                        builder.AddFile(component.Item1.FullName, component.Item1.Length);
                        builder.SetName(component.Item1.Name);
                        builder.SetExtension(
                            new BString("url-list", Encoding.UTF8),
                            new BString(component.Item2, Encoding.UTF8));

                        builder.CalculatePieces(new FileStreamProvider());
                        var torrent = builder.Build();

                        using (var stream = File.OpenWrite(component.Item3))
                        {
                            Trace.TraceInformation($"Writing torrent to {component.Item3}...");
                            var ts = new TorrentSerializer();
                            ts.Serialize(stream, torrent);
                        }
                    });
                }

                Trace.TraceInformation("Finished creating torrents.");
            }
            catch (Exception ex)
            {
                string msg = $"Failed to build torrents: {ex.Message}";
                Trace.TraceError(msg);
                MessageBox.Show(msg, Res.ErrorMessageCaption, icon: MessageBoxImage.Error);
            }
            finally
            {
                LoadingTorrents = false;
            }
        }

        public class FileStreamProvider : IFileStreamProvider
        {
            public Stream Resolve(string relativePath, out bool autoDispose)
            {
                autoDispose = true;
                return new FileStream(relativePath, FileMode.Open);
            }
        }

        public void HandleDroppedFiles(string[] paths)
        {
            string? modernFile = paths.FirstOrDefault(p => p.EndsWith(".mkv"));
            if (modernFile != null)
                ModernEncodePath = modernFile;

            string? compatabilityFile = paths.FirstOrDefault(p => p.EndsWith(".mp4"));
            if (compatabilityFile != null)
                CompatabilityEncodePath = compatabilityFile;
        }

#region Commands

        private RelayCommand? _saveTagsCommand;
        public RelayCommand SaveTagsCommand => _saveTagsCommand ??= new(
            execute: () =>
            {
                Settings.Default.Tags = Tags;
                Settings.Default.Save();
            },
            canExecute: () => !errors.ContainsKey(nameof(Tags)) && Tags != Settings.Default.Tags);

        private RelayCommand? _saveCredentialsCommand;
        public RelayCommand SaveCredentialsCommand => _saveCredentialsCommand ??= new(
            execute: () =>
            {
                Credentials.SaveCredentials(ArchiveEmail, GetSecurePassword!());
                Trace.TraceInformation("Saved credentials to the Windows Credential Manager.");
            });

        private AsyncRelayCommand? _getIdentifierCommand;
        public AsyncRelayCommand GetIdentifierCommand => _getIdentifierCommand ??= new(
            execute: GetUniqueIdentifier,
            canExecute: _ => !string.IsNullOrWhiteSpace(PageID) && !IsPageIDValid);

        private AsyncRelayCommand? _searchRecentCommand;
        public AsyncRelayCommand SearchRecentCommand => _searchRecentCommand ??= new(SearchRecentIAUploads);

        private AsyncRelayCommand? _getSubmissionCommand;
        public AsyncRelayCommand GetSubmissionCommand => _getSubmissionCommand ??= new(
            execute: GetSubmissionProperties,
            canExecute: _ => !string.IsNullOrWhiteSpace(Description));

        private AsyncRelayCommand? _uploadCommand;
        public AsyncRelayCommand UploadCommand => _uploadCommand ??= new(
            execute: Upload,
            canExecute: _ => !HasErrors);

        private AsyncRelayCommand? _buildTorrentsCommand;
        public AsyncRelayCommand BuildTorrentsCommand => _buildTorrentsCommand ??= new(
            execute: BuildTorrents,
            canExecute: _ => ModernTorrentPathsValid || CompatabilityTorrentPathsValid);

#endregion
    }
}
