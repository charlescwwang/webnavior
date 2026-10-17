import unittest

from checkInteractiveServices import result_for, summarize_har


class CompatibilityEvidenceTests(unittest.TestCase):
    def test_cloudfront_preflight_failure_remains_failure_with_visible_menu(self):
        requests = summarize_har([{
            "request": {"method": "OPTIONS", "url": "https://api.example.com/menu"},
            "response": {"status": 403, "headers": [{"name": "Server", "value": "CloudFront"}]},
        }])
        self.assertTrue(requests[0]["cloudFrontRejected"])
        self.assertEqual(requests[0]["kind"], "preflight")
        self.assertEqual(result_for(requests, True), "network-failure")

    def test_missing_response_is_inconclusive_rather_than_confirmed_failure(self):
        requests = summarize_har([{
            "request": {"method": "GET", "url": "https://api.example.com/menu"},
            "response": {"status": 0},
        }])
        self.assertEqual(result_for(requests, True), "network-evidence-incomplete")
        self.assertFalse(requests[0]["failed"])

    def test_page_shell_without_expected_menu_content_is_inconclusive(self):
        self.assertEqual(result_for([], False), "expected-content-not-observed")

    def test_visible_content_without_captured_network_is_inconclusive(self):
        self.assertEqual(result_for([], True), "network-evidence-incomplete")

    def test_report_excludes_authentication_and_query_data(self):
        requests = summarize_har([{
            "request": {
                "method": "GET",
                "url": "https://user:private@example.com/menu?token=secret&table=123#private",
                "headers": [{"name": "Authorization", "value": "Bearer secret"}],
            },
            "response": {
                "status": 200,
                "headers": [{"name": "Set-Cookie", "value": "private-cookie"}],
                "content": {"text": "private response"},
            },
        }])
        self.assertEqual(requests[0]["url"], "https://example.com/menu")
        self.assertNotIn("headers", requests[0])
        self.assertNotIn("content", requests[0])
        self.assertEqual(result_for(requests, True), "content-and-recorded-network-passed")


if __name__ == "__main__":
    unittest.main()
