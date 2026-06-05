import time
import urllib.request
import urllib.error
import json
import uuid

API_URL = "http://localhost:8000"

def make_request(url, method="GET", headers=None, data=None):
    if headers is None:
        headers = {}
    
    req_headers = {"Content-Type": "application/json"}
    req_headers.update(headers)
    
    req_data = None
    if data is not None:
        req_data = json.dumps(data).encode("utf-8")
        
    req = urllib.request.Request(url, data=req_data, headers=req_headers, method=method)
    
    try:
        with urllib.request.urlopen(req) as response:
            status_code = response.getcode()
            response_text = response.read().decode("utf-8")
            return status_code, json.loads(response_text) if response_text else {}
    except urllib.error.HTTPError as e:
        status_code = e.code
        response_text = e.read().decode("utf-8")
        try:
            parsed_err = json.loads(response_text)
        except Exception:
            parsed_err = response_text
        return status_code, parsed_err
    except Exception as e:
        return 500, str(e)

def test_sprint3_flow():
    print("=== STARTING SPRINT 3 BACKEND VALIDATION ===")
    
    # 1. Register/Login a new temporary test user to run clean tests
    test_uuid = uuid.uuid4().hex[:6]
    test_email = f"test_user_{test_uuid}@example.com"
    test_password = "SecurePassword123!"
    test_name = "Sprint Three Auditor"

    print(f"\n1. Registering user: {test_email}...")
    status, res = make_request(
        f"{API_URL}/api/v1/auth/register",
        method="POST",
        data={"email": test_email, "password": test_password, "full_name": test_name}
    )
    if status != 201:
        print(f"[ERROR] Registration failed: {res}")
        return False
    print("[OK] Registration successful.")

    print("\n2. Logging in...")
    status, res = make_request(
        f"{API_URL}/api/v1/auth/login",
        method="POST",
        data={"email": test_email, "password": test_password}
    )
    if status != 200:
        print(f"[ERROR] Login failed: {res}")
        return False
    token = res["access_token"]
    headers = {"Authorization": f"Bearer {token}"}
    print("[OK] Login successful. Token retrieved.")

    # 2. Fetch User Profile
    print("\n3. Testing GET /api/v1/auth/me profile endpoint...")
    status, profile = make_request(f"{API_URL}/api/v1/auth/me", method="GET", headers=headers)
    if status != 200:
        print(f"[ERROR] Profile fetch failed: {profile}")
        return False
    assert profile["email"] == test_email
    assert profile["full_name"] == test_name
    assert "created_at" in profile
    print(f"[OK] Profile verified successfully: {profile}")

    # 3. Create a clean Chat session (selected_doc_ids should start empty)
    print("\n4. Creating a new chat session...")
    status, chat_data = make_request(
        f"{API_URL}/api/v1/chats",
        method="POST",
        headers=headers,
        data={"selected_doc_ids": []}
    )
    if status != 201:
        print(f"[ERROR] Chat creation failed: {chat_data}")
        return False
    chat_id = chat_data["id"]
    assert chat_data["title"] == "New Chat"
    assert chat_data["selected_doc_ids"] == []
    print(f"[OK] Chat created successfully with ID: {chat_id}")

    # 4. Patch chat workspace document selections
    print("\n5. Testing PATCH /api/v1/chats/{chat_id}/documents selection update...")
    status, patch_data = make_request(
        f"{API_URL}/api/v1/chats/{chat_id}/documents",
        method="PATCH",
        headers=headers,
        data={"selected_doc_ids": []}
    )
    if status != 200:
        print(f"[ERROR] Workspace PATCH failed: {patch_data}")
        return False
    assert patch_data["selected_doc_ids"] == []
    print("[OK] Workspace PATCH empty list verified.")

    # 5. Verify multitenancy: try patching another user's document or invalid uuid
    print("\n6. Testing workspace validation on invalid document UUID...")
    bad_uuid = str(uuid.uuid4())
    status, res = make_request(
        f"{API_URL}/api/v1/chats/{chat_id}/documents",
        method="PATCH",
        headers=headers,
        data={"selected_doc_ids": [bad_uuid]}
    )
    if status != 404:
        print(f"[ERROR] Expected 404 on non-existent document UUID, got {status}: {res}")
        return False
    print("[OK] Document UUID validation verified (returned 404 as expected).")

    # 6. Test async title generation on first message
    print("\n7. Sending first message to trigger background title generation...")
    first_msg_text = "What is the standard termination clause for a NDA agreement?"
    status, res = make_request(
        f"{API_URL}/api/v1/chats/{chat_id}/messages",
        method="POST",
        headers=headers,
        data={"question": first_msg_text}
    )
    if status != 200:
        print(f"[ERROR] Message sending failed: {res}")
        return False
    print("[OK] First message posted. Waiting 3 seconds for background title generation task...")
    time.sleep(3)

    print("\n8. Fetching chat detail to verify async generated title...")
    status, chat_detail = make_request(f"{API_URL}/api/v1/chats/{chat_id}", method="GET", headers=headers)
    if status != 200:
        print(f"[ERROR] Failed to fetch chat details: {chat_detail}")
        return False
    print(f"-> Current Chat Title: '{chat_detail['title']}'")
    if chat_detail['title'] == "New Chat":
        print("[ERROR] Title was not updated.")
        return False
    print("[OK] Title successfully updated by async background worker using Groq!")
    
    print("\n=== ALL SPRINT 3 BACKEND VALIDATION TESTS PASSED ===")
    return True

if __name__ == "__main__":
    test_sprint3_flow()
