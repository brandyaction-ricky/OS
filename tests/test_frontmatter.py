from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
import sys


PROJECT_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT_ROOT / "src"))

from brandyaction_os.frontmatter import read_document, write_document


class FrontmatterTests(unittest.TestCase):
    def test_roundtrip_keeps_timestamp_as_string(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "artifact_v1.md"
            metadata = {
                "schema_version": "1.0",
                "updated_at": "2026-08-23T11:30:00+09:00",
                "version": 1,
                "is_latest": True,
            }
            write_document(path, metadata, "# Body\n")
            document = read_document(path)
            self.assertEqual(document.metadata["updated_at"], metadata["updated_at"])
            self.assertIsInstance(document.metadata["updated_at"], str)
            self.assertEqual(document.metadata["version"], 1)
            self.assertIs(document.metadata["is_latest"], True)


if __name__ == "__main__":
    unittest.main()
