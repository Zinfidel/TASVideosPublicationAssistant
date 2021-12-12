using AdonisUI.Controls;
using System;
using System.Collections.ObjectModel;
using System.Globalization;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Data;
using System.Windows.Media;

namespace TASVideosPublicationAssistant
{
    public sealed partial class LogWindow : AdonisWindow
    {
        private static LogWindow? instance;

        public ObservableCollection<string> Log { get; }

        private LogWindow(Window owner, ObservableCollection<string> log) :
            base()
        {
            instance = this;
            Owner = owner;
            Log = log;
            BindingOperations.EnableCollectionSynchronization(log, log); // Threaded access to the collection

            InitializeComponent();
        }

        public static void Show(Window owner, ObservableCollection<string> log)
        {
            if (instance == null)
            {
                instance ??= new LogWindow(owner, log);
                instance.Show();
            }
        }

        protected override void OnClosed(EventArgs e)
        {
            base.OnClosed(e);
            instance = null;
        }

        private void ScrollViewer_ScrollChanged(object sender, ScrollChangedEventArgs e)
        {
            if (e.ExtentHeightChange != 0 && sender is ScrollViewer scroll)
                scroll.ScrollToBottom();
        }
    }

    [ValueConversion(typeof(string), typeof(SolidColorBrush))]
    public sealed class LogColorConverter : IValueConverter
    {
        private static readonly SolidColorBrush DefaultColor = Brushes.White;

        public SolidColorBrush Default { get; set; } = DefaultColor;
        public SolidColorBrush Http { get; set; } = DefaultColor;
        public SolidColorBrush Information { get; set; } = DefaultColor;
        public SolidColorBrush Warning { get; set; } = DefaultColor;
        public SolidColorBrush Error { get; set; } = DefaultColor;

        public object Convert(object value, Type targetType, object parameter, CultureInfo culture)
        {
            string log = (string)value;
            int index = log.IndexOf(':');
            string prefix = index > -1 ? log.Remove(index) : string.Empty;

            switch (prefix)
            {
                case "Http": return Http;
                case "Information": return Information;
                case "Warning": return Warning;
                case "Error": return Error;
                default: return Default;
            }
        }

        public object ConvertBack(object value, Type targetType, object parameter, CultureInfo culture)
        {
            throw new NotImplementedException();
        }
    }
}
