# Impiricus Frontend

React Native (Expo) + TypeScript app that also runs on web.

## Dependencies

All project dependencies are declared in **`package.json`**.  
Exact locked versions for reproducible installs are in **`package-lock.json`**.

On another computer, install everything with:

```bash
cd frontend
npm install
```

### Runtime dependencies

| Package | Purpose |
|---------|---------|
| `expo` | Expo SDK / app tooling |
| `react` / `react-native` | UI framework |
| `react-dom` / `react-native-web` | Web support |
| `expo-linear-gradient` | Gradient background |
| `react-native-svg` | Icons + dotted pattern |
| `react-native-safe-area-context` | Safe area insets (nav bar) |
| `react-native-screens` | Native screen containers |
| `@react-navigation/native` | Navigation core |
| `@react-navigation/bottom-tabs` | Tab navigation |
| `expo-status-bar` | Status bar styling |
| `@expo/metro-runtime` | Metro runtime (web) |

### Dev dependencies

| Package | Purpose |
|---------|---------|
| `typescript` | TypeScript compiler |
| `@types/react` | React type definitions |

## Requirements

- **Node.js** `>= 20.19.4` (LTS recommended)
- **npm** (comes with Node)

## Run

```bash
cd frontend
npm install
npm run web      # browser
npm run ios      # iOS simulator (macOS)
npm run android  # Android emulator
npm start        # Expo Dev Tools (pick platform)
```
