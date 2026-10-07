# ClioPlay Send

A small web app for sending a destination from your phone to ClioPlay over Bluetooth.

## Use

1. Connect your phone to ClioPlay Bluetooth.
2. Open ClioPlay Send.
3. Paste a full Google Maps, Apple Maps, Waze or OpenStreetMap link, or paste coordinates directly.
4. Check the detected destination and choose **Route as new** or **Add as stop**.
5. Tap **Send to ClioPlay**.

The transfer takes one second. Music will stop during the transfer and may need to be resumed manually afterwards.

If a map app gives you a shortened link, open that link in your browser first and then copy the full URL from the address bar into ClioPlay Send.

## GitHub Pages

Place these files at the root of a GitHub repository, then enable **Settings → Pages → Deploy from a branch** and publish the repository root.

The site is fully static and requires no server or API.


## Transfer timing

The sender defaults to a 4 second Bluetooth media window. A compact **Transfer options** section lets the user choose 1, 2, 3, 4, 5, or 8 seconds; the selection is remembered on that device. Longer durations help when the head unit needs time to switch to Bluetooth audio before its AVRCP metadata poll sees the destination packet.
