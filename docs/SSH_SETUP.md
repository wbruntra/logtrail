# SSH and SSHFS Setup for Remote Log Monitoring

This document provides a general guide for configuring SSH access from one machine (the "Central Server" running Logtrail) to another machine (the "Remote Server" containing logs) and mounting the remote logs via SSHFS.

## Assumptions

- **Central Server**: The machine running Logtrail.
- **Remote Server**: The machine with the log files you want to view.
- We assume you have a user account on both machines (e.g., `admin`).

## Phase 1: Configuring Passwordless SSH

For Logtrail to read remote logs continuously via SSHFS without requiring manual password prompts, you need to set up SSH key authentication.

### 1. Generate an SSH Key on the Central Server

Log into the **Central Server** (where Logtrail runs) and generate a new SSH key pair.

```bash
# Run this on the Central Server
ssh-keygen -t ed25519 -C "logtrail-server"
```

- Keep pressing **Enter** to accept the default file location (`~/.ssh/id_ed25519`).
- When prompted for a passphrase, leave it **empty** (press Enter twice) so the server can connect automatically.

### 2. Copy the Check to the Remote Server

Now, copy the public key you just generated to the **Remote Server**. Replace `admin` and `REMOTE_IP` with the correct username and IP address for the remote system.

```bash
# Run this on the Central Server
ssh-copy-id william@50.116.62.14
```

- You will be prompted for the `admin` password on the remote server one last time.

### 3. Verify the Connection

Test the connection from the Central Server. It should log you into the Remote Server immediately without asking for a password.

```bash
ssh admin@REMOTE_IP
```

---

## Phase 2: Mounting Remote Logs using SSHFS

Once passwordless SSH is configured, you can mount the remote `logs` directory to the local filesystem.

### 1. Install SSHFS on the Central Server

```bash
# Ubuntu/Debian
sudo apt update
sudo apt install sshfs

# RHEL/CentOS/Rocky
sudo dnf install epel-release
sudo dnf install sshfs
```

### 2. Create a Local Mount Point

Create an empty directory on the Central Server where the remote logs will appear.

```bash
mkdir -p /home/william/logs/remote-app-server
```

### 3. Mount the Directory

Mount the remote `/var/log` (or your specific log directory) to the local folder using SSHFS.

```bash
sshfs william@50.116.62.14:/home/william/logs /home/william/logs/remote-server-02 -o allow_other,reconnect,IdentityFile=~/.ssh/id_ed25519_logtrail
```

**Options Used:**

- `allow_other`: Allows the Logtrail process to read the files, even if mounted by a different user. (You may need to edit `/etc/fuse.conf` and uncomment `user_allow_other` if this throws a permission error).
- `reconnect`: Automatically restores the mount if the network connection drops.
- `IdentityFile`: Explicitly tells SSHFS to use the key generated in Phase 1.

### 4. Configure Logtrail

Update the `central.config.yaml` file in your Logtrail setup to point to the new local mount point.

```yaml
logs:
  - name: 'Remote App Server Syslog'
    path: '/home/william/logs/remote-app-server/syslog'
    type: 'local'
    description: 'Syslog from the remote app server'
    enabled: true
```

---

## Phase 3: Persistent Mounts (Optional but Recommended)

The `sshfs` command above will be forgotten if the Central Server reboots. To make it persistent, add an entry to `/etc/fstab`.

Add the following single line to `/etc/fstab` on the Central Server (adjusting paths and IP as necessary):

```text
william@50.116.62.14:/home/william/logs /home/william/logs/remote-server-02 fuse.sshfs x-systemd.automount,_netdev,user,idmap=user,transform_symlinks,identityfile=/root/.ssh/id_ed25519_logtrail,allow_other,default_permissions,uid=1000,gid=1000 0 0
```

_(Note: If Logtrail runs as a specific user (like `william` with uid 1000), make sure the `uid` and `gid` match that user so Logtrail has read permissions. Also ensure the `identityfile` points to the absolute path of the private key)._
