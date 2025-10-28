from fastapi.testclient import TestClient
from app.main import app

client = TestClient(app)

def test_root():
    r = client.get("/")
    assert r.status_code == 200
    assert r.json().get("ok") is True


def test_list_podcasts():
    r = client.get("/podcasts")
    assert r.status_code == 200
    assert isinstance(r.json(), list)
