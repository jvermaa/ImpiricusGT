import os
from pathlib import Path

from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent / ".env")


def main() -> None:
    public_url = os.getenv("PUBLIC_VOICE_WSS_URL", "")
    if not public_url.startswith("wss://"):
        raise SystemExit("Set PUBLIC_VOICE_WSS_URL to the ngrok wss:// URL before configuring Twilio.")
    print("Inbound voice only.")
    print("Point the Twilio number voice webhook to POST https://<ngrok-host>/voice/incoming")
    print(f"ConversationRelay websocket: {public_url}")
    print("Do not enable SMS on this number.")


if __name__ == "__main__":
    main()
