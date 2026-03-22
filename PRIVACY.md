# Vocalype — Privacy Policy

**Effective date:** 2026-03-21
**Last updated:** 2026-03-21

---

## 1. Overview

Vocalype is a desktop speech-to-text application that processes audio locally on your device. We are committed to protecting your privacy and complying with applicable data protection regulations, including the General Data Protection Regulation (GDPR).

---

## 2. Data We Collect

### 2.1 Data stored locally on your device

The following data is created and stored **only on your machine** by default:

| Data                         | Purpose                                           | Location                                   |
| ---------------------------- | ------------------------------------------------- | ------------------------------------------ |
| Audio recordings (WAV files) | Enable playback and re-transcription in history   | App data directory / `recordings/`         |
| Transcription text           | History and search functionality                  | App data directory / `history.db`          |
| App settings and shortcuts   | User preferences                                  | App data directory / `settings_store.json` |
| Device ID                    | Identify this installation for license validation | App data directory / `auth.store.json`     |
| Auth token and session       | Keep you signed in                                | OS keyring (system credential store)       |

Vocalype **does not** upload your audio recordings or transcriptions to any server.

### 2.2 Data sent to Vocalype servers

When you use license validation, the following minimal data is transmitted:

| Field                                           | Purpose                                                |
| ----------------------------------------------- | ------------------------------------------------------ |
| `device_id` (SHA-256 hashed)                    | Identify the device for license seat management        |
| `app_version`                                   | Ensure compatibility and deliver correct license terms |
| `app_channel`                                   | Distinguish stable and development builds              |
| Integrity snapshot (release flag, tamper flags) | Detect binary tampering — contains no personal data    |

We do **not** send: transcription text, audio data, file paths, browser history, or any content you have dictated.

### 2.3 Account data

If you create a Vocalype account, we store:

- Email address (used to identify your account and send license emails)
- Password hash (we never store your plain-text password)
- Subscription and billing information (processed by our payment provider)

---

## 3. Data Retention

You control how long recordings and transcriptions are kept on your device through the **History Retention** setting:

- **Keep last N recordings** — auto-delete older entries once the limit is reached
- **3 days** — delete recordings older than 3 days
- **2 weeks** — delete recordings older than 2 weeks
- **3 months** (default for new installations) — delete recordings older than 3 months

Starred/saved recordings are never automatically deleted.

Server-side account data is retained as long as your account is active, and for a legally required period after deletion (typically 30 days).

---

## 4. Your Rights (GDPR)

If you are located in the European Union or European Economic Area, you have the following rights:

- **Right of access** — request a copy of the personal data we hold about you
- **Right to rectification** — ask us to correct inaccurate data
- **Right to erasure** ("right to be forgotten") — ask us to delete your account and associated data
- **Right to data portability** — export your transcription history at any time via **History → Export my data**
- **Right to object** — object to processing of your data in certain circumstances
- **Right to restriction** — ask us to restrict processing of your data

To exercise any of these rights, contact us at the address below.

---

## 5. Exporting Your Data

You can export all your transcriptions at any time:

1. Open Vocalype settings
2. Go to **History**
3. Click **Export my data**
4. Choose a format (TXT, CSV, Markdown, or JSON)

This gives you a complete copy of your transcription history stored on this device.

---

## 6. Deleting Your Data

### On-device data

- **Delete individual entries** — use the delete button on any history entry
- **Clear all history** — use the **Clear all history** button in History settings to permanently delete all recordings and transcriptions from this device

### Account data

To delete your Vocalype account and all associated server-side data, contact us at the address below. We will process your request within 30 days.

---

## 7. Third-Party Services

Vocalype may integrate with the following optional services:

- **Google Gemini API** — if you choose the Gemini transcription model, audio is sent to Google's servers. Google's privacy policy applies. This model is opt-in only.
- **Payment processor** — billing is handled by a third-party payment provider. We do not store your card details.

---

## 8. Security

- Auth tokens are stored in the OS keyring (Windows Credential Manager, macOS Keychain)
- Your device ID is hashed with SHA-256 before being sent to our servers
- All server communication uses HTTPS (TLS 1.2+)
- Audio files and transcriptions remain on your device

---

## 9. Children's Privacy

Vocalype is not directed at children under the age of 16. We do not knowingly collect personal data from children.

---

## 10. Changes to This Policy

We may update this policy from time to time. We will notify you of significant changes through the application. The "Last updated" date at the top of this page reflects the most recent revision.

---

## 11. Contact

For privacy-related questions, data subject requests, or to exercise your GDPR rights, please contact:

**Vocalype**
Email: privacy@vocalype.com _(placeholder — replace with actual contact)_
Website: https://vocalype.com

---

_Vocalype processes your data in accordance with the GDPR (Regulation (EU) 2016/679) and applicable national data protection laws._
