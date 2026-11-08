# People Directory

A shared directory served by Apache, with a single JSON file as its database.
There is no PHP, SQL, Python, PowerShell, build process or separate application
server. JavaScript runs in the browser; Apache handles authentication and
WebDAV writes. The original PowerShell script is retained for reference and is
not used by the new directory.

The public page retains the original layout, department buttons, first/last
name search, sortable columns, email links, photo thumbnail and enlarged
preview on hover or keyboard focus (the thumbnail is not a link), responsive
layout and persistent dark mode. The admin page supports
adding, editing, hiding and deleting people, and uploading or removing photos.
Uploads are resized in the browser to fit 320 × 320 pixels and stored as JPEG
inside the data file. Admins can also set the browser tab title and upload, remove or
restore the default logo. Custom logos must be JPEG, PNG or WebP up to 1 MB.
Side-by-side previews show the regular and inverted logo, and an admin can
choose whether to invert it in dark mode. Existing directories default to
inverting, as before. The browser tab title, logo and inversion choice are stored in
the same data file as the people.
A sample person is included.

In the admin page, **Import CSV** displays an example and lets you map columns
from a UTF-8 CSV file (maximum 5 MB). First name, last name and department
must be mapped and non-empty for every record; other fields are optional.
Headers such as `FirstName`, `LastName` and `Department` are automatically
matched, including names with spaces. Quoted commas and newlines are supported.
`Enabled` accepts true/false, yes/no or 1/0 and defaults to true.
Photos are not imported from CSV; upload them manually by editing each person.
Existing people and earlier CSV rows matching first name, last name and
department (case-insensitive) are skipped, not updated. Invalid records prevent
the entire import; the existing WebDAV lock and conflict check protect the save.

Page settings are collapsed by default on the admin page. The Log out button
returns to the public directory, but cannot clear browser-cached HTTP Basic
credentials. Close all browser windows to ensure the administrator session is
ended, especially on a shared device.

## Ubuntu / Apache setup

### Interactive installer

Copy this entire project directory to Ubuntu, including the `admin` and
`data` folders, then run:

```sh
cd PeopleDirectory
sudo bash install.sh
```

The menu offers install/update, backup, restore, wipe, password reset and
uninstall. First install sets an administrator password; an update offers to
reset or add one. The separate password action also adds or updates an account.
Keep `install.sh` in Unix (LF) line-ending format; Windows CRLF line endings
prevent Bash from running it. If needed, convert it in Ubuntu with
`sed -i 's/\r$//' install.sh`.

The installer creates or updates an HTTPS virtual host. It prompts for a hostname,
an existing TLS certificate/full chain and private key, a new self-signed
certificate, or the previously generated People Directory certificate. For a
new password file, it also prompts for an admin username and password.
Arrange for DNS to point to
the server. It installs Apache if needed, enables its required modules, and
installs the directory at `https://hostname/people/`. It does not configure
DNS, a firewall or an HTTP redirect.

For testing on Ubuntu under WSL, `localhost` with a self-signed certificate can
be accessed from Windows at `https://localhost/people/`. Apache normally
listens on all interfaces, so check the network and firewall configuration
before treating this as a private local-only installation.

The self-signed option creates a certificate for the entered hostname (or IPv4
address) valid for 365 days, and configures Apache to use it. It stores the
certificate and private key in the root-only directory
`/etc/apache2/people-directory-tls/`; it will not overwrite that directory.
Browsers do not trust this certificate by default. Distribute and configure
trust for the certificate through a secure, managed process before users enter
admin credentials; a browser warning means the server's identity is not
verified. The private key must remain secret. Monitor the expiration date and
replace the certificate before it expires.

To replace either type of certificate later, update `SSLCertificateFile` and
`SSLCertificateKeyFile` in `/etc/apache2/sites-available/people-directory.conf`
to point to the new certificate/full chain and private key, then run:

```sh
sudo apache2ctl configtest && sudo systemctl reload apache2
```

Configure clients to trust the replacement certificate as needed.

To update or repair, copy the new project files to Ubuntu, rerun the installer
and select option 1. After confirmation it replaces the `people-directory` Apache site,
including manual changes to that site's configuration, and reuses its hostname
and certificate paths. It preserves existing `config.js`, logo and
administrator accounts automatically; other application files are replaced.
It asks whether to preserve the directory data (the default) or replace it
with the sample after typing `RESET`. The old data is backed up in
`/var/lib/people-directory/` and must be kept secure. Stop admins editing during
an update or reset; back up the data before maintenance. If the existing
hostname or TLS paths cannot be read safely, it prompts for them instead. If
the password file is missing, it asks for a new administrator account.
On update, the former default title in `config.js` is changed to
`PeopleDirectory`; other configured titles and titles saved by admins are
preserved. An existing legacy default logo is copied to the new logo path.

To change installation settings, run `sudo bash install.sh --reconfigure`
and select option 1.

The backup action saves the complete JSON file, including photos and page
settings, under `/var/backups/people-directory/` with root-only access. The
restore action asks for an absolute backup path, validates its JSON and backs
up existing data before replacement. The wipe action backs up the data and
replaces people with the sample entry while retaining page settings. Stop
admins editing before backup, restore, wipe or update. These actions require
Python 3 to validate and manipulate the JSON.

Uninstall disables and removes this site's Apache configuration and installed
application files, but leaves Apache and its packages installed. It asks
whether to also delete directory data, installer-created backups, administrator
credentials and the generated TLS certificate and key. Other files are left in
place. Certificate files outside the generated TLS directory are not deleted.

Use a hostname not already used by another HTTPS virtual host. Inspect
`sudo apache2ctl -S` for conflicts. If configuring or enabling the site fails,
the installer attempts to restore its previous configuration and enabled
state; application files, data changes, administrator account changes and
installed packages are not rolled back. Follow the error message and inspect
Apache's logs and configuration before retrying. If self-signed certificate
generation was interrupted, review and remove
the incomplete certificate directory before retrying; a completed certificate
can instead be selected using the existing-certificate option. See the
security and verification steps below.

### Manual installation into an existing virtual host

These instructions assume Apache 2.4, an **existing HTTPS virtual host**, and
the Debian/Ubuntu `www-data` Apache user. Adapt paths and the user if needed.
HTTPS is essential: HTTP Basic authentication sends credentials in a form that
is easily recovered without TLS. Do not expose the admin endpoint over plain
HTTP, including through another virtual host or reverse proxy.

1. Copy the application files to the server, then from this project directory
   install them (subsequent updates should not overwrite the data file):

   ```sh
   sudo install -d /opt/people-directory/admin /opt/people-directory/images
   sudo install -m 644 index.html style.css config.js theme.js directory.js /opt/people-directory/
   sudo install -m 644 admin/index.html admin/admin.js /opt/people-directory/admin/
   sudo install -d -o www-data -g www-data -m 750 /var/lib/people-directory
   if [ ! -e /var/lib/people-directory/directory.json ]; then
     sudo install -o www-data -g www-data -m 640 data/directory.json /var/lib/people-directory/directory.json
   fi
   ```

   The writable data directory is deliberately separate from the application
   files. If you have the original logo, place it at
   `/opt/people-directory/images/logo.png`; the page hides the logo when
   it is absent.

2. Enable Apache modules and create individual admin accounts:

   ```sh
   sudo a2enmod alias auth_basic authn_file authz_core dav dav_fs
   sudo htpasswd -c /etc/apache2/people-directory.htpasswd first-admin
   # For additional users, omit -c; using -c again replaces the file.
   sudo htpasswd /etc/apache2/people-directory.htpasswd another-admin
   ```

   Enter passwords interactively. Keep the password file outside all web
   roots. Manage or remove accounts with `htpasswd`; see `man htpasswd`.
   Apache Basic credentials are cached by the browser, so closing the browser
   may be necessary to sign out.

3. Paste the contents of [apache.conf](apache.conf) inside the HTTPS
   `<VirtualHost>` serving this directory. The aliases and locations must not
   be exposed by an HTTP virtual host. Do not place a broader alias for
   `/people/` before these aliases. The `dav_fs` module's Ubuntu configuration
   normally supplies `DavLockDB`; ensure its lock database directory is
   writable by Apache and is not web-accessible. Ensure the existing server
   configuration does not override the access restrictions in this example.

   ```sh
   sudo apache2ctl configtest
   sudo systemctl reload apache2
   ```

4. Visit `https://your-server/people/`, then follow **Admin** and sign in.
   Confirm that the public directory works, the admin URL prompts for
   credentials, and you can save an edit. Test in a private browser window to
   confirm anonymous access to `/people/admin/` and
   `/people/admin/data/directory.json` is denied, and that anonymous writes to
   `/people/data/directory.json` fail.

The data file is publicly readable by design. Do not store passwords or
sensitive/private staff information in it. All authenticated admins can edit
all entries. Do not allow untrusted users write access to the data or lock
directories, and do not expose these directories through any other alias or
web server. WebDAV locks and a fresh-data comparison prevent two admins using
this interface from silently overwriting one another; external edits must not
be made while the directory is in use. If a conflict occurs, reload the admin
page and re-enter the change. Use a single Apache server and shared lock
database, not independently configured servers writing the same file.

Back up `/var/lib/people-directory/directory.json` regularly, including its
embedded photos. Restore it while no admins are editing. The JSON file and
password file are not included in application updates.

## Customization

Edit [config.js](config.js) before deployment or in `/opt/people-directory` to
choose the default page title, displayed fields and their order, initial sort field,
sidebar grouping (`Department`, `Location` or `Manager`), and the default
location for people without one. Supported field names are listed in that
file. Admin page settings override the default title and logo. Name-link
variants can point to the website or the photo. The manager is
a plain text name, not a reference that automatically follows another
person's name changes. An entry with location `Exclude` is hidden, as in the
original script; the admin can also uncheck **Show in directory**.

Edit [style.css](style.css) for styling or [index.html](index.html) to add a
custom heading. Apache serves the latest data directly, so no regeneration or
photo refresh job is necessary. A browser page reload fetches current data.
The directory should be accessed through Apache rather than opened directly
from disk.
