using AdonisUI;
using AdonisUI.Controls;
using Microsoft.Win32;
using System;
using System.IO;
using System.Security;
using System.Windows;
using TASVideosPublicationAssistant.Properties;

namespace TASVideosPublicationAssistant
{
    public partial class MainWindow : AdonisWindow
    {
        public static readonly DependencyProperty IsDarkProperty =
            DependencyProperty.Register("IsDark", typeof(bool), typeof(MainWindow), new PropertyMetadata(Settings.Default.DarkMode, OnIsDarkChanged));

        private static void OnIsDarkChanged(DependencyObject d, DependencyPropertyChangedEventArgs e)
        {
            bool newVal = (bool)e.NewValue;
            ChangeTheme(newVal);
            Settings.Default.DarkMode = newVal;
            Settings.Default.Save();
        }

        private static void ChangeTheme(bool darkMode)
        {
            Uri theme = darkMode ? ResourceLocator.DarkColorScheme : ResourceLocator.LightColorScheme;
            ResourceLocator.SetColorScheme(Application.Current.Resources, theme);
        }

        private readonly MainViewModel viewModel;
        private readonly OpenFileDialog dialog;

        public MainWindow()
        {
            DataContext = viewModel = new MainViewModel();

            dialog = new()
            {
                InitialDirectory = Settings.Default.OpenFileInitialDirectory,
                RestoreDirectory = true,
                CheckFileExists = true,
                CheckPathExists = true,
                ValidateNames = true
            };

            ChangeTheme(Settings.Default.DarkMode);
            InitializeComponent();

            viewModel.GetSecurePassword = () => ArchivePasswordBox.SecurePassword;
            viewModel.SetSecurePassword = (ss) => SetPassword(ArchivePasswordBox.SecurePassword);

            // Fill out the user/pass fields initially.
            Credentials.GetCredentials(out string username, out SecureString password);
            viewModel.ArchiveEmail = username;
            SetPassword(password);
        }

        private void SetPassword(SecureString sourceSS)
        {
            // Would prefer to use SecureString.AppendChar loop, but p-box only returns copies of its SecureString.
            sourceSS.UseDecryptedSecureString((uss) => ArchivePasswordBox.Password = uss);
        }

        private void VideoFile_Drop(object sender, DragEventArgs e)
        {
            if (e.Data.GetDataPresent(DataFormats.FileDrop))
            {
                var paths = (string[])e.Data.GetData(DataFormats.FileDrop);
                viewModel.HandleDroppedFiles(paths);
            }
        }

        private void VideoFile_DragEnter(object sender, DragEventArgs e)
        {
            e.Effects = e.Data.GetDataPresent(DataFormats.FileDrop) ? DragDropEffects.Copy : DragDropEffects.None;
        }

        private void BrowseFilesButton_Click(object sender, RoutedEventArgs e)
        {
            dialog.Filter = sender == ModernBrowse ? "Matroska Video Files (*.mkv)|*.mkv" : "MP4 Video Files (*.mp4)|*.mp4";

            if (dialog.ShowDialog(this) != true)
                return;

            // Remember the last location each time the dialog is opened.
            var dir = Path.GetDirectoryName(dialog.FileName);
            dialog.InitialDirectory = dir;
            Settings.Default.OpenFileInitialDirectory = dir;
            Settings.Default.Save();

            if (sender == ModernBrowse)
                viewModel.ModernEncodePath = dialog.FileName;
            else
                viewModel.CompatabilityEncodePath = dialog.FileName;
        }

        private void LogButton_Click(object sender, RoutedEventArgs e)
        {
            LogWindow.Show(this, ((App)Application.Current).Log);
        }

        private void CopyButton_Click(object sender, RoutedEventArgs e)
        {
            if (sender == ModernCopyButton)
                Clipboard.SetText(viewModel.ModernEncodeUrl);
            else
                Clipboard.SetText(viewModel.CompatabilityEncodeUrl);
        }
    }
}
