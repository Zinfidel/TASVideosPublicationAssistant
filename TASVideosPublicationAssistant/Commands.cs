using AsyncAwaitBestPractices.MVVM;
using System;
using System.Threading.Tasks;
using System.Windows.Input;

namespace TASVideosPublicationAssistant
{
    /// <summary>Slight modification of AsyncCommand that automatically hooks up to the WPF CommandManager.</summary>
    public class AsyncRelayCommand : AsyncCommand
    {
        public AsyncRelayCommand(Func<Task> execute, Func<object?, bool>? canExecute = null, Action<Exception>? onException = null, bool continueOnCapturedContext = false) : 
            base(execute, canExecute, onException, continueOnCapturedContext)
        {
            CommandManager.RequerySuggested += (s, e) => RaiseCanExecuteChanged();
        }
    }

    /// <summary>Slight modification of AsyncCommand that automatically hooks up to the WPF CommandManager.</summary>
    public class AsyncRelayCommand<T> : AsyncCommand<T>
    {
        public AsyncRelayCommand(Func<T?, Task> execute, Func<object?, bool>? canExecute = null, Action<Exception>? onException = null, bool continueOnCapturedContext = false) :
            base(execute, canExecute, onException, continueOnCapturedContext)
        {
            CommandManager.RequerySuggested += (s, e) => RaiseCanExecuteChanged();
        }
    }

    public class RelayCommand : ICommand
    {
        private readonly Action execute;
        private readonly Func<bool> canExecute;

        public RelayCommand(Action execute)
        {
            this.execute = execute;
            canExecute = () => true;
        }

        public RelayCommand(Action execute, Func<bool> canExecute)
        {
            this.execute = execute;
            this.canExecute = canExecute;
        }

        public event EventHandler? CanExecuteChanged
        {
            add { CommandManager.RequerySuggested += value; }
            remove { CommandManager.RequerySuggested -= value; }
        }

        public bool CanExecute(object? _) => canExecute();

        public void Execute(object? _) => execute();
    }

    public class RelayCommand<T> : ICommand
    {
        private readonly Action<T?> execute;
        private readonly Func<T?, bool> canExecute;

        public RelayCommand(Action<T?> execute)
        {
            this.execute = execute;
            canExecute = _ => true;
        }

        public RelayCommand(Action<T?> execute, Func<T?, bool> canExecute)
        {
            this.execute = execute;
            this.canExecute = canExecute;
        }

        public event EventHandler? CanExecuteChanged
        {
            add { CommandManager.RequerySuggested += value; }
            remove { CommandManager.RequerySuggested -= value; }
        }

        public bool CanExecute(T? parameter) => canExecute(parameter);

        public void Execute(T? parameter) => execute(parameter);

        bool ICommand.CanExecute(object? parameter)
        {
            if (parameter is null)
                return canExecute(default);
            else if (parameter is T param)
                return canExecute(param);
            else
                throw new ArgumentException(null, nameof(parameter));
        }

        void ICommand.Execute(object? parameter)
        {
            if (parameter is null)
                execute(default);
            else if (parameter is T param)
                execute(param);
            else
                throw new ArgumentException(null, nameof(parameter));
        }
    }
}
