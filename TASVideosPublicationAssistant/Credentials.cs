using CredentialManagement;
using System.Security;

namespace TASVideosPublicationAssistant
{
    public static class Credentials
    {
        private const string CredentialTarget  = "TASVideosPublicationAssistant";

        public static void GetCredentials(out string username, out SecureString password)
        {
            using var creds = new CredentialSet(CredentialTarget);
            creds.Load();
            if (creds.Count > 0)
            {
                username = creds[0].Username;
                password = creds[0].SecurePassword;
            }
            else
            {
                username = string.Empty;
                password = new SecureString();
            }
        }

        public static void SaveCredentials(string username, SecureString password)
        {
            using var cred = new Credential(username, null, CredentialTarget, CredentialType.Generic);
            cred.SecurePassword = password;
            cred.PersistanceType = PersistanceType.LocalComputer;
            cred.Save();
        }
    }
}
