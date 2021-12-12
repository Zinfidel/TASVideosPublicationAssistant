using System;
using System.Collections;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.ComponentModel;
using System.Linq;
using System.Runtime.CompilerServices;

namespace TASVideosPublicationAssistant
{
    public partial class MainViewModel : INotifyPropertyChanged, INotifyDataErrorInfo
    {
        #region INotifyPropertyChanged

        public event PropertyChangedEventHandler? PropertyChanged;

        public void OnPropertyChanged([CallerMemberName] string propertyName = "")
        {
            PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(propertyName));
        }

        private void Set<T>(ref T backingField, T value, bool clearErrors = false, [CallerMemberName] string propertyName = "")
        {
            backingField = value;
            if (clearErrors)
                ClearErrors(propertyName);
            OnPropertyChanged(propertyName);
        }

        #endregion

        #region INotifyDataErrorInfo

        private readonly ConcurrentDictionary<string, List<string>> errors = new();

        public bool HasErrors => errors.Any();

        public event EventHandler<DataErrorsChangedEventArgs>? ErrorsChanged;

        private void OnErrorsChanged(string propertyName)
        {
            ErrorsChanged?.Invoke(this, new DataErrorsChangedEventArgs(propertyName));
            OnPropertyChanged(nameof(HasErrors));
        }

        public IEnumerable GetErrors(string? propertyName)
        {
            if (propertyName is null || !errors.ContainsKey(propertyName))
                return Enumerable.Empty<string>();
            else
                return errors[propertyName].ToList(); // avoid concurrent modification
        }

        public void AddError(string message, [CallerMemberName] string propertyName = "")
        {
            errors.AddOrUpdate(propertyName, new List<string>() { message },
                (_, old) =>
                {
                    old.Add(message);
                    return old;
                });

            OnErrorsChanged(propertyName);
        }

        public void SetError(string message, [CallerMemberName] string propertyName = "")
        {
            var newMessage = new List<string>() { message };
            errors.AddOrUpdate(propertyName, newMessage, (_, _) => newMessage);
            OnErrorsChanged(propertyName);
        }

        public void RemoveError(string message, [CallerMemberName] string propertyName = "")
        {
            if (!errors.TryGetValue(propertyName, out var errorList))
                return;

            errorList.Remove(message);
            if (errorList.Count == 0)
                errors.TryRemove(propertyName, out _);
        }

        public void ClearErrors([CallerMemberName] string propertyName = "")
        {
            errors.TryRemove(propertyName, out _);
            OnErrorsChanged(propertyName);
        }

        #endregion
    }
}
