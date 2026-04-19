import importlib.util
import os
import tempfile
import unittest
from pathlib import Path


def load_backend_module():
    module_path = Path(__file__).with_name("app.py")
    spec = importlib.util.spec_from_file_location("vocalype_backend_app", module_path)
    if spec is None or spec.loader is None:
        raise RuntimeError("Unable to load backend app module")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class BackendSecurityTests(unittest.TestCase):
    def setUp(self):
        self._previous_env = os.environ.copy()
        self._tempdir = tempfile.TemporaryDirectory()
        os.environ["DATABASE_PATH"] = str(Path(self._tempdir.name) / "test.db")
        os.environ["JWT_SECRET"] = "x" * 32
        os.environ["TRUST_X_FORWARDED_FOR"] = "0"
        os.environ["SKIP_DB_INIT"] = "1"
        self.app_module = load_backend_module()
        self.client = self.app_module.app.test_client()

    def tearDown(self):
        os.environ.clear()
        os.environ.update(self._previous_env)
        self._tempdir.cleanup()

    def test_login_rejects_invalid_json_types_with_400(self):
        response = self.client.post(
            "/auth/login",
            json={"email": ["attacker@example.com"], "password": {"bad": "type"}},
        )

        self.assertEqual(response.status_code, 400)
        self.assertIn("Champ invalide", response.get_data(as_text=True))

    def test_register_rejects_non_string_device_identifier(self):
        response = self.client.post(
            "/auth/register",
            json={
                "email": "user@example.com",
                "password": "Password123!",
                "name": "User",
                "device_id": 12345,
            },
        )

        self.assertEqual(response.status_code, 400)
        self.assertIn("device_id", response.get_data(as_text=True))

    def test_forwarded_for_is_ignored_without_trusted_proxy(self):
        with self.app_module.app.test_request_context(
            "/auth/login",
            headers={"X-Forwarded-For": "203.0.113.9"},
            environ_base={"REMOTE_ADDR": "198.51.100.10"},
        ):
            self.assertEqual(self.app_module.request_client_ip(), "198.51.100.10")

    def test_forwarded_for_uses_client_hop_when_proxy_is_trusted(self):
        previous = self.app_module.TRUST_X_FORWARDED_FOR
        self.app_module.TRUST_X_FORWARDED_FOR = True
        try:
            with self.app_module.app.test_request_context(
                "/auth/login",
                headers={"X-Forwarded-For": "203.0.113.9"},
                environ_base={"REMOTE_ADDR": "198.51.100.10"},
            ):
                self.assertEqual(self.app_module.request_client_ip(), "203.0.113.9")
        finally:
            self.app_module.TRUST_X_FORWARDED_FOR = previous

    def test_hsts_header_is_added_for_https_requests(self):
        with self.app_module.app.test_request_context(
            "/health",
            headers={"X-Forwarded-Proto": "https"},
            environ_base={"REMOTE_ADDR": "127.0.0.1"},
        ):
            response = self.app_module.add_security_headers(
                self.app_module.app.make_response(("ok", 200))
            )

        self.assertIn("Strict-Transport-Security", response.headers)


if __name__ == "__main__":
    unittest.main()
