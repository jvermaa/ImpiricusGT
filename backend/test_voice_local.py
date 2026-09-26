import urllib.request


def main() -> None:
    with urllib.request.urlopen("http://127.0.0.1:8000/voice/incoming", data=b"") as response:
        body = response.read().decode("utf-8")
    if "ConversationRelay" not in body:
        raise SystemExit("TwiML did not include ConversationRelay.")
    if "sms" in body.lower():
        raise SystemExit("Voice response mentioned SMS.")
    print(body)
    print("Local inbound TwiML check passed.")


if __name__ == "__main__":
    main()
