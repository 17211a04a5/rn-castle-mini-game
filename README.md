# Castle & Balloon Pop (React Native / Expo)

A production-ready React Native game rendered with React Native Skia. Features a beautiful castle scene with patrolling guards, trotting horses, and a balloon-popping minigame with sound.

## Prerequisites
- Node.js 18+ and Git
- Android SDK (Android Studio) for local Android testing, or Xcode for iOS (macOS only)
- Expo CLI and EAS CLI

```powershell
npm i -g eas-cli
```

## Install dependencies
From the project root:

```powershell
cd castle-balloon-rn
# Align versions to your Expo SDK
npx expo install
```

## Run locally
```powershell
# Start the dev server
npm run start

# Android (emulator or USB device)
npm run android

# iOS (requires macOS + Xcode)
npm run ios
```

Tip: On first run, Android may prompt to install SDK components and a virtual device.

## Build production binaries with EAS
EAS builds on cloud machines and handles native config automatically.

1) Log in to Expo/EAS
```powershell
eas login
```

2) Configure project (one-time)
- The `app.json` already includes the Skia Expo plugin.
- Optional: Set a real `projectId` under `expo.extra.eas.projectId` by running:

```powershell
eas init --id
```

3) Android release (AAB)
```powershell
npm run build:android
```
- EAS can generate and manage your keystore automatically. Accept defaults when prompted.
- When done, the CLI will show a download link for your `.aab`.

4) iOS release (IPA)
```powershell
npm run build:ios
```
- Requires an Apple Developer account. EAS can create/manage certificates and provisioning profiles.

## Submit to stores
After a successful build:

```powershell
# Google Play
npm run submit:android

# App Store Connect (macOS recommended)
npm run submit:ios
```
Follow the interactive prompts. You’ll need store listings (app name, description, screenshots, etc.).

## Sound notes
- The pop sound uses a small remote asset via `expo-av`. If you want the app fully offline, replace the URL in `App.tsx` with a local file and add it under `assets/`, then change to `require('./assets/pop.mp3')`.

## Troubleshooting
- If the app crashes on start after adding plugins, run:
```powershell
npx expo prebuild --clean
```
- If Skia shows blank screen on Android in release builds, ensure the plugin is present in `app.json` and rebuild.
- If audio is muted, tap once on the screen (OS policies) and/or ensure device volume is up.
