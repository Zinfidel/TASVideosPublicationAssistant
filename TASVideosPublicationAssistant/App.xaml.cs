using System;
using System.Collections.Generic;
using System.Collections.ObjectModel;
using System.Diagnostics;
using System.Globalization;
using System.Windows;
using System.Windows.Data;

namespace TASVideosPublicationAssistant
{
    public partial class App : Application
    {
        public readonly ObservableCollection<string> Log = new();

        public App() : base()
        {
            Trace.Listeners.Add(new LogTraceListener(Log));
            InitializeComponent();
        }
    }

    public class LogTraceListener : TraceListener
    {
        private readonly ICollection<string> log;
        private string lastWrite = string.Empty;

        public LogTraceListener(ICollection<string> log)
        {
            this.log = log;
        }

        public override void Write(string? message)
        {
            if (!string.IsNullOrEmpty(message))
                lastWrite = message.Split()[1];
        }

        public override void WriteLine(string? message)
        {
            if (string.IsNullOrEmpty(message))
                return;

            if (!string.IsNullOrEmpty(lastWrite))
                message = lastWrite + " " + message;

            lock (log)
            {
                log.Add(message);
            }

            lastWrite = string.Empty;
        }
    }

    #region Converters

    [ValueConversion(typeof(bool), typeof(Visibility))]
    public sealed class BoolToVisibilityConverter : IValueConverter
    {
        public Visibility TrueValue { get; set; }
        public Visibility FalseValue { get; set; }

        public BoolToVisibilityConverter()
        {
            TrueValue = Visibility.Visible;
            FalseValue = Visibility.Collapsed;
        }

        public object Convert(object value, Type targetType, object parameter, CultureInfo culture)
        {
            if (value is not bool)
                return DependencyProperty.UnsetValue;
            return (bool)value ? TrueValue : FalseValue;
        }

        public object ConvertBack(object value, Type targetType, object parameter, CultureInfo culture)
        {
            if (Equals(value, TrueValue))
                return true;
            if (Equals(value, FalseValue))
                return false;
            return DependencyProperty.UnsetValue;
        }
    }

    [ValueConversion(typeof(double), typeof(bool))]
    public sealed class IndeterminateProgressConverter : IValueConverter
    {
        public object Convert(object value, Type targetType, object parameter, CultureInfo culture)
        {
            if (value is double progress)
                return progress == 0.0;
            else
                return DependencyProperty.UnsetValue;
        }

        public object ConvertBack(object value, Type targetType, object parameter, CultureInfo culture)
        {
            if (value is bool indeterminate && indeterminate)
                return 0.0;
            else
                return DependencyProperty.UnsetValue;
        }
    }

    [ValueConversion(typeof(bool), typeof(bool))]
    public sealed class InvertBooleanConverter : IValueConverter
    {
        public object Convert(object value, Type targetType, object parameter, CultureInfo culture)
            => !(bool?)value ?? true;

        public object ConvertBack(object value, Type targetType, object parameter, CultureInfo culture)
            => !(value as bool?) ?? DependencyProperty.UnsetValue;
    }

    [ValueConversion(typeof(object), typeof(bool))]
    public sealed class NotNullConverter : IValueConverter
    {
        public object Convert(object value, Type targetType, object parameter, CultureInfo culture)
            => value != null;

        public object ConvertBack(object value, Type targetType, object parameter, CultureInfo culture)
            => DependencyProperty.UnsetValue;
    }

    [ValueConversion(typeof(string), typeof(bool))]
    public sealed class NotWhitespaceConverter : IValueConverter
    {
        public object Convert(object value, Type targetType, object parameter, CultureInfo culture)
        {
            if (value is string str)
                return !string.IsNullOrWhiteSpace(str);
            else
                return DependencyProperty.UnsetValue;
        }

        public object ConvertBack(object value, Type targetType, object parameter, CultureInfo culture)
        {
            if (value is bool b && !b)
                return string.Empty;
            else
                return DependencyProperty.UnsetValue;
        }
    }

    #endregion
}
