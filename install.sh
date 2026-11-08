#!/usr/bin/env bash
set -Eeuo pipefail

reconfigure=false
if (($#)); then
    if (($# == 1)) && [[ "$1" == "--reconfigure" ]]; then
        reconfigure=true
    else
        echo "Usage: sudo bash install.sh [--reconfigure]" >&2
        exit 1
    fi
fi

if [[ ${EUID} -ne 0 ]]; then
    echo "Run this installer with sudo: sudo bash install.sh" >&2
    exit 1
fi
if [[ ! -r /etc/os-release ]] || ! grep -qiE '^(ID|ID_LIKE)=.*ubuntu' /etc/os-release; then
    echo "This installer is intended for Ubuntu." >&2
    exit 1
fi
if [[ ! -t 0 ]]; then
    echo "Run this installer interactively in a terminal." >&2
    exit 1
fi

source_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)
site=/etc/apache2/sites-available/people-directory.conf
enabled_site=/etc/apache2/sites-enabled/people-directory.conf
password_file=/etc/apache2/people-directory.htpasswd
data_file=/var/lib/people-directory/directory.json
tls_dir=/etc/apache2/people-directory-tls
backup_dir=/var/backups/people-directory

require_data() {
    if [[ ! -f "$data_file" || ! -r "$data_file" ]]; then
        echo "Directory data not found or unreadable: $data_file" >&2
        exit 1
    fi
}

validate_data() {
    if ! command -v python3 >/dev/null; then
        echo "Python 3 is required to validate directory data; install python3 and retry." >&2
        exit 1
    fi
    python3 -c 'import json, sys
try:
    with open(sys.argv[1], encoding="utf-8") as f:
        data = json.load(f)
    if not isinstance(data, dict) or not isinstance(data.get("people"), list):
        raise ValueError("expected an object containing a people array")
except (OSError, ValueError) as error:
    print("Invalid directory data: " + str(error), file=sys.stderr)
    sys.exit(1)' "$1"
}

backup_data() {
    require_data
    validate_data "$data_file"
    install -d -o root -g root -m 700 "$backup_dir"
    backup=$(mktemp "$backup_dir/directory.json.backup.XXXXXXXX")
    if ! install -o root -g root -m 600 "$data_file" "$backup"; then
        rm -f -- "$backup"
        echo "Could not create backup." >&2
        exit 1
    fi
    echo "Backup created: $backup"
}

replace_data() {
    local replacement=$1 temp
    validate_data "$replacement"
    install -d -o www-data -g www-data -m 750 /var/lib/people-directory
    temp=$(mktemp /var/lib/people-directory/.directory.json.XXXXXXXX)
    if ! install -o www-data -g www-data -m 640 "$replacement" "$temp"; then
        rm -f -- "$temp"
        echo "Could not prepare directory data." >&2
        exit 1
    fi
    if ! mv -f -- "$temp" "$data_file"; then
        rm -f -- "$temp"
        echo "Could not replace directory data." >&2
        exit 1
    fi
}

set_admin_password() {
    local admin
    if ! command -v htpasswd >/dev/null; then
        echo "htpasswd is unavailable; install apache2-utils and retry." >&2
        exit 1
    fi
    read -r -p "Administrator username: " admin
    if [[ ! "$admin" =~ ^[a-zA-Z0-9][a-zA-Z0-9._@-]*$ ]]; then
        echo "Invalid administrator username." >&2
        exit 1
    fi
    if [[ -e "$password_file" ]]; then
        htpasswd "$password_file" "$admin"
    else
        install -d -m 755 /etc/apache2
        htpasswd -c "$password_file" "$admin"
    fi
    chown root:www-data "$password_file"
    chmod 640 "$password_file"
}

echo "People Directory"
echo "  1. Install / update PeopleDirectory"
echo "  2. Backup existing user data"
echo "  3. Restore backup user data"
echo "  4. Wipe existing user data"
echo "  5. Reset admin password"
echo "  6. Uninstall"
read -r -p "Choice: " action
case "$action" in
    1) ;;
    2)
        echo "Stop administrators editing while creating a backup."
        backup_data
        exit 0
        ;;
    3)
        echo "Stop administrators editing before restoring data."
        read -r -p "Absolute path to backup JSON: " restore_file
        if [[ "$restore_file" != /* || ! -f "$restore_file" || ! -r "$restore_file" ]]; then
            echo "Enter an absolute path to a readable backup file." >&2
            exit 1
        fi
        validate_data "$restore_file"
        read -r -p "Type RESTORE to replace current directory data: " confirmation
        if [[ "$confirmation" != RESTORE ]]; then echo "Cancelled."; exit 0; fi
        if [[ -e "$data_file" ]]; then backup_data; fi
        replace_data "$restore_file"
        echo "Directory data restored."
        exit 0
        ;;
    4)
        require_data
        validate_data "$data_file"
        validate_data "$source_dir/data/directory.json"
        echo "This replaces all people with the sample entry and preserves site settings."
        echo "Stop administrators editing before continuing."
        read -r -p "Type WIPE to replace the user data: " confirmation
        if [[ "$confirmation" != WIPE ]]; then echo "Cancelled."; exit 0; fi
        backup_data
        temp=$(mktemp /var/lib/people-directory/.people-wipe.XXXXXXXX)
        if ! python3 -c 'import json, sys
with open(sys.argv[1], encoding="utf-8") as f:
    data = json.load(f)
with open(sys.argv[2], encoding="utf-8") as f:
    sample = json.load(f)
data["people"] = sample["people"]
with open(sys.argv[3], "w", encoding="utf-8") as f:
    json.dump(data, f, ensure_ascii=False, indent=2)
    f.write("\n")' "$data_file" "$source_dir/data/directory.json" "$temp"; then
            rm -f -- "$temp"
            echo "Could not prepare wiped data." >&2
            exit 1
        fi
        if ! replace_data "$temp"; then
            rm -f -- "$temp"
            exit 1
        fi
        rm -f -- "$temp"
        echo "People replaced with the sample."
        exit 0
        ;;
    5) set_admin_password; echo "Administrator password updated."; exit 0 ;;
    6)
        echo "This removes the People Directory Apache site and application files, not Apache itself."
        echo "Data, backups, administrator credentials and generated TLS files can be kept or deleted."
        read -r -p "Type UNINSTALL to continue: " confirmation
        if [[ "$confirmation" != UNINSTALL ]]; then echo "Cancelled."; exit 0; fi
        read -r -p "Delete directory data, backups, credentials and generated TLS files too? [y/N]: " delete_data
        case "$delete_data" in
            ""|[Nn]|[Nn][Oo]) delete_data=false ;;
            [Yy]|[Yy][Ee][Ss]) delete_data=true ;;
            *) echo "Invalid choice." >&2; exit 1 ;;
        esac
        if [[ -L "$site" || ( -e "$site" && ! -f "$site" ) ]] ||
           { [[ -L "$enabled_site" ]] && [[ "$(readlink "$enabled_site")" != "../sites-available/people-directory.conf" ]]; } ||
           [[ -e "$enabled_site" && ! -L "$enabled_site" ]]; then
            echo "Unexpected Apache site configuration; review it manually before uninstalling." >&2
            exit 1
        fi
        if [[ -L "$enabled_site" ]]; then a2dissite people-directory.conf; fi
        rm -f -- "$site"
        apache2ctl configtest
        if systemctl is-active --quiet apache2; then systemctl reload apache2; fi
        rm -f -- /opt/people-directory/{index.html,style.css,config.js,theme.js,directory.js} \
            /opt/people-directory/admin/{index.html,admin.js} /opt/people-directory/images/{logo.png,timbre-logo.png}
        for dir in /opt/people-directory/admin /opt/people-directory/images /opt/people-directory; do
            if [[ -d "$dir" ]] && ! rmdir -- "$dir"; then
                echo "Left non-empty directory: $dir" >&2
            fi
        done
        if [[ "$delete_data" == true ]]; then
            rm -f -- "$data_file" "$password_file" "$tls_dir/certificate.pem" "$tls_dir/private-key.pem"
            for backup in "$backup_dir"/directory.json.backup.* /var/lib/people-directory/directory.json.backup.*; do
                if [[ -f "$backup" && ! -L "$backup" ]]; then rm -f -- "$backup"; fi
            done
            for dir in "$backup_dir" "$tls_dir" /var/lib/people-directory; do
                if [[ -d "$dir" ]] && ! rmdir -- "$dir"; then
                    echo "Left non-empty directory: $dir" >&2
                fi
            done
        fi
        echo "People Directory uninstalled."
        exit 0
        ;;
    *) echo "Invalid choice." >&2; exit 1 ;;
esac

for file in index.html style.css config.js theme.js directory.js admin/index.html admin/admin.js data/directory.json apache.conf; do
    if [[ ! -f "$source_dir/$file" ]]; then
        echo "Missing required file: $source_dir/$file" >&2
        exit 1
    fi
done
echo "People Directory installer"
existing_site=false
if [[ -L "$site" || ( -e "$site" && ! -f "$site" ) ]]; then
    echo "Cannot replace $site: it is not a regular file. Review it manually." >&2
    exit 1
fi
if [[ -L "$enabled_site" ]] && [[ "$(readlink "$enabled_site")" != "../sites-available/people-directory.conf" ]]; then
    echo "Cannot replace $enabled_site: it points to a different site. Review it manually." >&2
    exit 1
fi
if [[ -e "$enabled_site" && ! -L "$enabled_site" ]]; then
    echo "Cannot replace $enabled_site: it is not the expected site symlink. Review it manually." >&2
    exit 1
fi
if [[ -e "$site" || -L "$enabled_site" ]]; then
    existing_site=true
    echo "An Apache site named people-directory already exists."
    echo "Continuing will replace its configuration, including any manual changes."
    if [[ "$reconfigure" == false ]]; then
        echo "Existing config.js and logo will be preserved; you can choose whether to reset an administrator password."
        echo "You can choose whether to preserve or replace the directory data."
    fi
    read -r -p "Replace the existing site? [y/N]: " answer
    if [[ ! "$answer" =~ ^[Yy]([Ee][Ss])?$ ]]; then
        echo "Cancelled."
        exit 0
    fi
fi

read_site_value() {
    awk -v directive="$1" '
        tolower($1) == tolower(directive) {
            count++
            value = $0
            sub(/^[[:space:]]*[^[:space:]]+[[:space:]]+/, "", value)
            sub(/[[:space:]]+$/, "", value)
            if (value ~ /^"[^"]*"$/) value = substr(value, 2, length(value) - 2)
        }
        END {
            if (count != 1) exit 1
            print value
        }
    ' "$site"
}

automatic_update=false
certificate_choice=1
if [[ "$existing_site" == true && "$reconfigure" == false && -f "$site" ]]; then
    if hostname=$(read_site_value ServerName) &&
       certificate=$(read_site_value SSLCertificateFile) &&
       private_key=$(read_site_value SSLCertificateKeyFile) &&
       [[ "$hostname" =~ ^[a-zA-Z0-9]([a-zA-Z0-9.-]*[a-zA-Z0-9])?$ ]] &&
       [[ "$certificate" =~ ^/[a-zA-Z0-9._/-]+$ && -f "$certificate" && -r "$certificate" ]] &&
       [[ "$private_key" =~ ^/[a-zA-Z0-9._/-]+$ && -f "$private_key" && -r "$private_key" ]]; then
        automatic_update=true
        echo "Reusing hostname $hostname and the existing certificate and key."
    else
        echo "Could not safely read the existing hostname or TLS paths; enter them below." >&2
    fi
fi
if [[ "$automatic_update" == false ]]; then
echo "This creates or updates an HTTPS virtual host."
echo "Choose a hostname that is not already used by another Apache HTTPS virtual host."
read -r -p "Directory hostname (e.g. people.example.com): " hostname
if [[ ! "$hostname" =~ ^[a-zA-Z0-9]([a-zA-Z0-9.-]*[a-zA-Z0-9])?$ ]]; then
    echo "Invalid hostname." >&2
    exit 1
fi
echo "TLS certificate:"
echo "  1) Use an existing certificate and private key"
echo "  2) Create a new self-signed certificate locally"
if [[ -f "$tls_dir/certificate.pem" && -r "$tls_dir/certificate.pem" &&
      -f "$tls_dir/private-key.pem" && -r "$tls_dir/private-key.pem" ]]; then
    echo "  3) Reuse the existing People Directory self-signed certificate"
fi
read -r -p "Choice [1]: " certificate_choice
certificate_choice=${certificate_choice:-1}
case "$certificate_choice" in
    1)
        read -r -p "Absolute path to TLS certificate / full chain: " certificate
        read -r -p "Absolute path to TLS private key: " private_key
        for path in "$certificate" "$private_key"; do
            if [[ ! "$path" =~ ^/[a-zA-Z0-9._/-]+$ || ! -f "$path" || ! -r "$path" ]]; then
                echo "Certificate and key must be readable files with absolute paths (letters, digits, dot, underscore, hyphen and slash only)." >&2
                exit 1
            fi
        done
        ;;
    2)
        certificate=$tls_dir/certificate.pem
        private_key=$tls_dir/private-key.pem
        if [[ -e "$tls_dir" || -L "$tls_dir" ]]; then
            echo "$tls_dir already exists. Use the existing certificate option or review it before removing it." >&2
            exit 1
        fi
        echo "Browsers will not trust a self-signed certificate by default."
        ;;
    3)
        certificate=$tls_dir/certificate.pem
        private_key=$tls_dir/private-key.pem
        if [[ ! -f "$certificate" || ! -r "$certificate" || ! -f "$private_key" || ! -r "$private_key" ]]; then
            echo "The existing People Directory certificate and key are not readable." >&2
            exit 1
        fi
        echo "Ensure the existing certificate is valid for $hostname and trusted by clients."
        ;;
    *)
        echo "Invalid certificate choice." >&2
        exit 1
        ;;
esac
fi
update_admin=true
if [[ -f "$password_file" ]]; then
    read -r -p "Reset or add an administrator password? [y/N]: " answer
    case "$answer" in
        ""|[Nn]|[Nn][Oo]) update_admin=false ;;
        [Yy]|[Yy][Ee][Ss]) ;;
        *) echo "Invalid choice." >&2; exit 1 ;;
    esac
fi
if [[ "$update_admin" == true ]]; then
    read -r -p "Administrator username: " admin
    if [[ ! "$admin" =~ ^[a-zA-Z0-9][a-zA-Z0-9._@-]*$ ]]; then
        echo "Invalid administrator username." >&2
        exit 1
    fi
fi

reset_data=false
if [[ -e "$data_file" ]]; then
    echo "Directory data:"
    echo "  1) Preserve existing data (recommended)"
    echo "  2) Replace existing data with the sample (a backup will be created)"
    read -r -p "Choice [1]: " data_choice
    case "${data_choice:-1}" in
        1) ;;
        2)
            read -r -p "Type RESET to replace the existing directory data: " confirmation
            if [[ "$confirmation" != RESET ]]; then
                echo "Data reset not confirmed. Cancelled."
                exit 0
            fi
            reset_data=true
            ;;
        *) echo "Invalid data choice." >&2; exit 1 ;;
    esac
fi

echo
echo "This will install Apache if needed, enable modules, install files in /opt/people-directory,"
echo "store data in /var/lib/people-directory, and enable the HTTPS site $site."
echo "Existing config.js and logo will be preserved; other application files will be replaced."
if [[ "$reset_data" == true ]]; then
    echo "Existing directory data will be backed up and replaced with the sample."
else
    echo "Existing directory data will be preserved."
fi
if [[ "$automatic_update" == false ]]; then
    read -r -p "Continue? [y/N]: " answer
    if [[ ! "$answer" =~ ^[Yy]([Ee][Ss])?$ ]]; then
        echo "Cancelled."
        exit 0
    fi
fi

missing=()
packages=(apache2 apache2-utils)
if [[ "$certificate_choice" == 2 ]]; then
    packages+=(openssl)
fi
for package in "${packages[@]}"; do
    if ! dpkg-query -W -f='${db:Status-Status}' "$package" 2>/dev/null | grep -qx installed; then
        missing+=("$package")
    fi
done
if ((${#missing[@]})); then
    apt-get update
    apt-get install -y "${missing[@]}"
fi

if [[ "$certificate_choice" == 2 ]]; then
    mkdir -m 700 "$tls_dir"
    if [[ "$hostname" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
        subject_alt_name="IP:$hostname"
    else
        subject_alt_name="DNS:$hostname"
    fi
    if ! (
        umask 077
        openssl req -x509 -newkey rsa:3072 -sha256 -nodes -days 365 \
            -subj "/CN=$hostname" -addext "subjectAltName=$subject_alt_name" \
            -addext "basicConstraints=critical,CA:FALSE" \
            -addext "keyUsage=critical,digitalSignature,keyEncipherment" \
            -addext "extendedKeyUsage=serverAuth" \
            -keyout "$private_key" -out "$certificate"
    ); then
        echo "Certificate generation failed. Review and remove the incomplete $tls_dir before retrying." >&2
        exit 1
    fi
    chmod 644 "$certificate"
    echo "Created a self-signed certificate valid for 365 days: $certificate"
fi

install -d -m 755 /opt/people-directory /opt/people-directory/admin /opt/people-directory/images
install -m 644 "$source_dir"/{index.html,style.css,theme.js,directory.js} /opt/people-directory/
install -m 644 "$source_dir"/admin/{index.html,admin.js} /opt/people-directory/admin/
if [[ ! -e /opt/people-directory/config.js ]]; then
    install -m 644 "$source_dir/config.js" /opt/people-directory/config.js
else
    sed -i 's/^  title: "timbre employee directory",$/  title: "PeopleDirectory",/' /opt/people-directory/config.js
fi
if [[ ! -e /opt/people-directory/images/logo.png ]]; then
    if [[ -f /opt/people-directory/images/timbre-logo.png ]]; then
        install -m 644 /opt/people-directory/images/timbre-logo.png /opt/people-directory/images/logo.png
    elif [[ -f "$source_dir/images/logo.png" ]]; then
        install -m 644 "$source_dir/images/logo.png" /opt/people-directory/images/logo.png
    fi
fi
install -d -o www-data -g www-data -m 750 /var/lib/people-directory
if [[ "$reset_data" == true ]]; then
    data_backup=$(mktemp /var/lib/people-directory/directory.json.backup.XXXXXXXX)
    cp -p -- "$data_file" "$data_backup"
    echo "Existing directory data backed up to $data_backup."
fi
if [[ ! -e "$data_file" || "$reset_data" == true ]]; then
    data_temp=$(mktemp /var/lib/people-directory/.directory.json.XXXXXXXX)
    install -o www-data -g www-data -m 640 "$source_dir/data/directory.json" "$data_temp"
    mv -f -- "$data_temp" "$data_file"
fi

if [[ "$update_admin" == true ]]; then
    if [[ -e "$password_file" ]]; then htpasswd "$password_file" "$admin"
    else htpasswd -c "$password_file" "$admin"; fi
fi
chown root:www-data "$password_file"
chmod 640 "$password_file"

a2enmod alias auth_basic authn_file authz_core dav dav_fs ssl

site_was_enabled=false
[[ -L "$enabled_site" ]] && site_was_enabled=true
site_backup=
if [[ -f "$site" ]]; then
    site_backup=$(mktemp /etc/apache2/sites-available/.people-directory.backup.XXXXXXXX)
    cp -p -- "$site" "$site_backup"
fi
site_changed=false
cleanup() {
    local result=$?
    if ((result != 0)); then
        if [[ "$site_changed" == true ]]; then
            if [[ -n "$site_backup" ]]; then
                if cp -p -- "$site_backup" "$site"; then
                    echo "Restored the previous Apache site configuration." >&2
                    rm -f -- "$site_backup"
                else
                    echo "Could not restore the previous site. Backup: $site_backup" >&2
                fi
            else
                rm -f -- "$site"
            fi
            if [[ "$site_was_enabled" == false ]] && [[ -L "$enabled_site" ]]; then
                if ! a2dissite people-directory.conf >/dev/null; then
                    echo "Could not disable the new site; check $enabled_site." >&2
                fi
            fi
        elif [[ -n "$site_backup" ]]; then
            rm -f -- "$site_backup"
        fi
        echo "Installation failed. Check Apache configuration, certificate paths and any backup messages above." >&2
        echo "Application files and packages already changed are not rolled back." >&2
    fi
}
trap cleanup EXIT

site_changed=true
{
    printf '<VirtualHost *:443>\n'
    printf '    ServerName %s\n' "$hostname"
    printf '    SSLEngine on\n'
    printf '    SSLCertificateFile "%s"\n' "$certificate"
    printf '    SSLCertificateKeyFile "%s"\n' "$private_key"
    printf '    ErrorLog ${APACHE_LOG_DIR}/people-directory-error.log\n'
    printf '    CustomLog ${APACHE_LOG_DIR}/people-directory-access.log combined\n'
    cat "$source_dir/apache.conf"
    printf '\n</VirtualHost>\n'
} > "$site"
chmod 644 "$site"
a2ensite people-directory.conf
apache2ctl configtest
if systemctl is-active --quiet apache2; then
    systemctl reload apache2
else
    systemctl enable --now apache2
fi
trap - EXIT
if [[ -n "$site_backup" ]]; then
    rm -f -- "$site_backup"
fi

echo
echo "Installed: https://$hostname/people/"
echo "Ensure DNS points to this server and HTTPS port 443 is reachable."
if [[ "$certificate_choice" == 2 ]]; then
    echo "The self-signed certificate must be trusted by clients before they can verify this server."
    echo "Certificate: $certificate"
    echo "Private key: $private_key"
fi
echo "Verify in a private browser that admin access requires a password and anonymous writes are denied."
echo "See README.md for account management, backups, and security checks."
