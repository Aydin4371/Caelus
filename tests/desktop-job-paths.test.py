import importlib.util
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location('job_paths', Path(__file__).resolve().parents[1] / 'src-tauri/src/job_paths.py')
paths = importlib.util.module_from_spec(spec)
spec.loader.exec_module(paths)

class JobPathsTests(unittest.TestCase):
    def test_result_does_not_need_to_exist(self):
        request = r'C:\Users\Aydin Test\AppData\Local\Kythros\request.json'
        result = r'C:\Users\Aydin Test\AppData\Local\Kythros\result.json'
        expected = '/mnt/c/Users/Aydin Test/AppData/Local/Kythros/request.json'
        resolved = paths.resolve_job_paths(request, result, '', lambda p: p == expected)
        self.assertEqual(resolved, (expected, expected.replace('request.json', 'result.json')))

    def test_custom_mount_and_unicode(self):
        resolved = paths.resolve_job_paths(r'D:\Zoë\request.json', r'D:\Zoë\result.json',
            'D:\\ /windows/data 9p rw,aname=drvfs;path=D:\\ 0 0',
            lambda p: p == '/windows/data/Zoë/request.json')
        self.assertEqual(resolved[1], '/windows/data/Zoë/result.json')

    def test_unreadable_request_is_reported(self):
        with self.assertRaises(FileNotFoundError):
            paths.resolve_job_paths(r'C:\request.json', r'C:\result.json', '', lambda p: False)

    def test_network_paths_rejected(self):
        with self.assertRaises(ValueError):
            paths.resolve_job_paths(r'\\server\share\request.json', r'\\server\share\result.json', '')

if __name__ == '__main__':
    unittest.main()
