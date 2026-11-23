# Run CourtPlus Cloud on EC2 in Mumbai

## 1. Check the student account and launch EC2

1. Open the AWS Student or Learner Lab console, start the lab if required, and select **Asia Pacific (Mumbai), ap-south-1**. Check the lab's region and instance permissions and remaining credit. Standard Free Tier eligibility depends on the account's creation date and plan. Check the actual account's offer before launching. [EC2 Free Tier usage](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/ec2-free-tier-usage.html)
2. In **EC2 → Instances → Launch instances**, name the instance **courtplus-cloud**. Choose Ubuntu Server 24.04 LTS, x86-64, and **t3.micro**. Use **t2.micro** if the lab permits it and Mumbai offers it for your account. Select standard CPU credits on T3 to avoid surplus credit charges. An encrypted 16 GiB gp3 EBS root disk is enough for the runtime and backups taken off the instance. Use a public subnet with auto-assigned public IPv4. [Launch an EC2 instance](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/EC2_GetStarted.html)
3. Attach an EC2 instance profile with the `AmazonSSMManagedInstanceCore` policy and confirm that SSM Agent is installed and running. Give the instance outbound HTTPS access to the regional Systems Manager endpoints. Create a security group with the following inbound rules and leave ports 22 and 3000 closed. [Session Manager instance permissions](https://docs.aws.amazon.com/systems-manager/latest/userguide/session-manager-getting-started-instance-profile.html) · [Security group rules](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/security-group-rules-reference.html)

   | Port | Source |
   | --- | --- |
   | TCP 80 | 0.0.0.0/0 |
   | TCP 443 | 0.0.0.0/0 |

4. Wait for the instance to appear as a managed node. In EC2 select the instance, choose **Connect → Session Manager**, and start a session with an IAM principal authorized to access this instance. Configure session logging to S3 or CloudWatch Logs if the lab permits it. [Start a Session Manager session](https://docs.aws.amazon.com/systems-manager/latest/userguide/session-manager-working-with-sessions-start.html)

## 2. Install Docker Engine and transfer the release

From the instance, install Docker Engine with its official Ubuntu apt repository. [Docker Engine on Ubuntu](https://docs.docker.com/engine/install/ubuntu/)

```sh
sudo apt-get update
sudo apt-get install -y ca-certificates curl
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc
. /etc/os-release
sudo tee /etc/apt/sources.list.d/docker.sources >/dev/null <<EOF
Types: deb
URIs: https://download.docker.com/linux/ubuntu
Suites: $VERSION_CODENAME
Components: stable
Architectures: $(dpkg --print-architecture)
Signed-By: /etc/apt/keyrings/docker.asc
EOF
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo docker compose version
```

Build off-instance on a machine with Docker. Use a private S3 release prefix that your workstation can upload to and the instance profile can read. Give the instance read access only to that prefix and use the AWS CLI on both machines.

```sh
docker build --platform linux/amd64 -f deploy/Dockerfile -t courtplus-cloud:local .
docker save courtplus-cloud:local | gzip > deploy/courtplus-cloud.tar.gz
aws s3 cp deploy/ s3://YOUR_PRIVATE_BUCKET/courtplus-release/ --recursive --exclude '*' \
  --include courtplus-cloud.tar.gz --include docker-compose.yml --include docker-compose.signing.yml \
  --include Caddyfile --include 'chromium-seccomp.*'
```

In the Session Manager shell, download the release files to the deployment directory.

```sh
mkdir -p ~/courtplus/deploy
aws s3 cp s3://YOUR_PRIVATE_BUCKET/courtplus-release/ ~/courtplus/deploy/ --recursive
```

## 3. Configure the hostname and SQLCipher secret

In the Session Manager shell, work from the deployment directory. Make a DNS A record pointing to the public IPv4 for your domain. If the team has no domain, replace the dots in the EC2 public IPv4 with dashes and append **.sslip.io**. Keep the hostname stable for links already printed in draft PDFs.

```sh
cd ~/courtplus/deploy
sudo docker load -i courtplus-cloud.tar.gz
install -d -m 0700 secrets
umask 077
openssl rand -hex 32 > secrets/db_key
sudo chown 1000:1000 secrets/db_key
sudo chmod 0400 secrets/db_key
cat > .env <<'EOF'
COURTPLUS_SITE=replace-with-the-fully-qualified-hostname
COURTPLUS_BIND=0.0.0.0
COURTPLUS_HANDOFF_MINUTES=60
EOF
sudo docker compose up -d
sudo docker compose ps
```

Generate the database key only on first deployment. Back it up separately from the database. Compose mounts the host file read-only as a secret and the cloud runs as UID 1000. The named database volume lives on the instance's EBS root disk by default. Caddy uses the hostname to obtain a public Let's Encrypt certificate, redirect HTTP to HTTPS, and forward to the private cloud container. [Caddy automatic HTTPS](https://caddyserver.com/docs/automatic-https)

Check public HTTPS from your workstation after DNS and issuance settle.

```sh
curl -fsS https://YOUR_HOSTNAME/health
```

If it fails, check DNS, the security group, and the output of **sudo docker compose logs caddy cloud**.

## 4. Create accounts and set up verification

Create the first admin in the Session Manager shell. Enter a unique password of at least 12 characters at the prompt. The CLI takes it from stdin and stores an Argon2id hash.

```bash
read -rs -p 'Admin password: ' courtplus_password; printf '\n'
printf '%s\n' "$courtplus_password" |
  sudo docker compose exec -T cloud node apps/appliance/dist/main.js create-account cloud-admin admin
unset courtplus_password
```

Repeat with an individual account name and a role for each user. The case editors are **legal_aid**, **dlsa**, and **superintendent**. **utrc_member** can read and export returns. **admin** can read and withdraw published receipts. DLSA posts handoffs and the superintendent acknowledges them and records s.479(3) filings. Accounts in this deployment share the same anonymised dataset. Visit **/login** for the web app and **/handoffs** for real-time handoffs and overdue escalations.

CourtPlus verifies publisher signatures against the office's enrolled Ed25519 public key. Verify the publisher and office label out of band before enrolling a desktop signing key. Use the exact same official office label in the signed receipt.

```sh
sudo docker compose exec -T cloud node apps/appliance/dist/main.js trust-issuer "OFFICIAL OFFICE LABEL" < office-public.pem
```

A desktop client can publish the signed receipt and manifest to **POST /api/receipts** and use the response **url** to construct the HTTPS QR. Only the signed envelopes are needed for publication. If using server-side draft printing on a release with the export workspace, generate a separate Ed25519 key as a secret and enroll the public half.

```sh
openssl genpkey -algorithm ED25519 -out secrets/draft_signing_key
openssl pkey -in secrets/draft_signing_key -pubout -out office-public.pem
sudo chown 1000:1000 secrets/draft_signing_key
sudo chmod 0400 secrets/draft_signing_key
sudo docker compose exec -T cloud node apps/appliance/dist/main.js trust-issuer "OFFICIAL OFFICE LABEL" < office-public.pem
```

Add **COURTPLUS_ISSUING_OFFICE** with the same office label to **.env**. For s.479(3) drafts also supply **COURTPLUS_PRISON**, and for DLSA notes supply **COURTPLUS_DISTRICT**. Start with the signing overlay and use the same file list for subsequent Compose operations.

```sh
sudo docker compose -f docker-compose.yml -f docker-compose.signing.yml up -d
```

Server-generated PDFs contain a QR for **/v/{receiptId}**. The public page displays signature status, the document fingerprint, the office, and receipt and screening status. Original order PDFs, source quotes, names and case numbers stay local.

To redeploy from the deployment directory after loading the new image and copying the release files, recreate the services so Caddy and Docker pick up the new configuration. Include `-f docker-compose.signing.yml` after the base file for deployments that already use server-side signing.

```sh
sudo docker compose -f docker-compose.yml up -d --no-build --force-recreate --wait
```

## 5. Back up, restore, and stop after the event

1. Record the audit head in a separate trusted location. Stop the cloud while archiving the named volume so new transactions cannot race the backup.

   ```sh
   umask 077
   sudo docker compose stop cloud
   sudo docker compose run --rm --no-deps -T cloud node apps/appliance/dist/main.js verify-audit > audit-head.json
   sudo docker compose run --rm --no-deps -T cloud tar -C /var/lib/courtplus -cf - . > courtplus-db.tar
   sudo docker compose up -d
   ```

2. Copy the archive and head to controlled storage. Keep the original DB secret separately. To test restoration on an empty volume with that same secret, stream the archive using **sudo docker compose run --rm --no-deps -T cloud tar -C /var/lib/courtplus -xf - < courtplus-db.tar**. Run **verify-audit** and compare its head before allowing writes. An encrypted EBS snapshot can serve as a second backup.
3. Set a small billing alarm in CloudWatch, if the lab permits it. In Billing Preferences enable billing alerts, then in **US East (N. Virginia)** select **Billing → Total Estimated Charge** in CloudWatch and use an SNS email destination with a confirmed subscription. If the lab restricts billing permissions, have the account owner configure the alarm and use the lab credit dashboard to monitor spend. Review EBS, snapshot, IPv4 and credit usage. [CloudWatch billing alarms](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/monitor_estimated_charges_with_cloudwatch.html)
4. After the event, stop the instance from the EC2 console. EBS and retained public address resources can still incur charges. An automatically assigned IPv4 can change on restart. Update DNS or sslip.io configuration if needed, and account for any links printed with the previous host. [EC2 stop and start](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/Stop_Start.html) · [EC2 lifecycle billing](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/ec2-instance-lifecycle.html)
