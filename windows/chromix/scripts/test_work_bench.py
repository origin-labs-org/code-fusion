#!/usr/bin/env python3
"""Harmless output fixtures only: no provider, app, signing, or probe execution."""
import contextlib
import copy
import importlib.machinery
import importlib.util
import io
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

PATH = Path(__file__).with_name("work-bench")
loader = importlib.machinery.SourceFileLoader("work_bench", str(PATH))
spec = importlib.util.spec_from_loader(loader.name, loader)
bench = importlib.util.module_from_spec(spec)
loader.exec_module(bench)


def summary(name="explain", request=1, **changes):
    values = dict(status="Completed", parts=1, parts_done=1, objects="note", tokens=120,
                  cost=20, accounting="Some(ProviderReported)")
    values.update(changes)
    return (f"lead-run: scenario={name} request={request} status={values['status']} wall_ms=10 "
            f"steps=2 turns=1 searches=0 pages=0 parts={values['parts']} parts_done={values['parts_done']} "
            f"objects={values['objects']} revised=0 inputs=0 tokens={values['tokens']} "
            f"cost_micro_usd={values['cost']} accounting={values['accounting']} asks=0\n")


MODELS = "lead-run: models lead=fixture-lead page=fixture-page light=fixture-light\nlead-run: search engine=fixture-search\n"
APPS = "loopback-site: check=apps asked=1 named=true yours=true cookies=true read=true pages=[fixture]\nloopback-site: check=Apps passed=true\n"


class EvidenceTests(unittest.TestCase):
    def test_completed_process_is_not_semantic_correctness(self):
        row = bench.parse("explain", summary(), 0, 12)
        self.assertTrue(row["process_completed"])
        self.assertTrue(row["run_completed"])
        self.assertIsNone(row["task_verified"])
        self.assertIsNone(row["fixture_verified"])
        self.assertIn("task-unverified", bench.result_label(row))

    def test_failures_cannot_pass_from_final_status_or_objects(self):
        for output, code in [
            (summary() + "lead-part: helper=Browser state=Failed need=blocked/test\n", 0),
            (summary(parts_done=0), 0),
            (summary(status="Blocked"), 0),
            (summary() + "lead-run: scenario=explain request=1 run_failure=test\n", 0),
            (summary() + "lead-run: event=ModelRefused { error: Unauthorized }\n", 0),
            (summary(), -9), ("", 0), (summary("trip"), 0), (summary() * 2, 0),
        ]:
            with self.subTest(output=output, code=code):
                self.assertFalse(bench.parse("explain", output, code, 12)["run_completed"])

    def test_apps_requires_complete_true_predicates(self):
        row = bench.parse("day", summary("apps") + APPS, 0, 12)
        self.assertTrue(row["fixture_verified"])
        self.assertIsNone(row["task_verified"])
        for checks in ("check=apps", APPS.replace("read=true", "read=false"),
                       APPS.replace("passed=true", "passed=false"), APPS * 2,
                       APPS.replace("asked=1", "asked=2")):
            self.assertFalse(bench.parse("day", summary("apps") + checks, 0, 12)["fixture_verified"])

    def test_save_retains_every_request_and_only_checks_file_presence(self):
        output = summary("save", 1) + summary("save", 2, tokens=80, cost=10)
        row = bench.parse("save", output + "lead-run: scenario=save files_written=1\n", 0, 30)
        self.assertTrue(row["fixture_verified"])
        self.assertEqual((row["tokens"], row["cost_micro_usd"]), (200, 30))
        self.assertEqual(len(row["request_evidence"]), 2)
        self.assertIsNone(row["task_verified"])
        self.assertFalse(bench.parse("save", summary("save", 2), 0, 30)["run_completed"])
        self.assertFalse(bench.parse("save", output, 0, 30)["fixture_verified"])

    def test_accounting_and_exact_reported_role_ids_preserved(self):
        row = bench.parse("explain", MODELS + summary(), 0, 12)
        self.assertEqual(row["models"], [dict(lead="fixture-lead", page="fixture-page", light="fixture-light")])
        self.assertEqual(row["accounting"], ["Some(ProviderReported)"])
        self.assertEqual(row["search_engines"], ["fixture-search"])
        self.assertIn("first attempt", row["accounting_scope"])
        for output in ("", summary(accounting="None", tokens=0, cost=0)):
            row = bench.parse("explain", output, 0, 12)
            self.assertIsNone(row["tokens"])
            self.assertIsNone(row["cost_micro_usd"])
            self.assertIn("unknown", bench.cell(row))

    def test_legacy_success_is_unverified(self):
        self.assertEqual(bench.result_label({"ok": True}), "legacy/unverified")


class ComparisonTests(unittest.TestCase):
    def setUp(self):
        row = bench.parse("explain", MODELS + summary(), 0, 12)
        row.update(args=["--live-lead", "explain"], scenario_source="fixture-source")
        self.run = dict(schema=bench.SCHEMA, stamp="fixture", commit="fixture", environment={},
                        platform=["fixture"], harness="fixture", rows=[row])

    def compare(self, other):
        with tempfile.TemporaryDirectory() as folder, contextlib.redirect_stdout(io.StringIO()) as output:
            a, b = Path(folder, "a.json"), Path(folder, "b.json")
            a.write_text(json.dumps(self.run))
            b.write_text(json.dumps(other))
            code = bench.compare(str(a), str(b))
            return code, output.getvalue()

    def test_matching_observed_setup_is_explicitly_descriptive(self):
        code, output = self.compare(copy.deepcopy(self.run))
        self.assertEqual(code, 0)
        self.assertIn("Descriptive deltas only", output)

    def test_model_accounting_scenario_and_missing_cases_are_unmatched(self):
        for field, value in (("models", []), ("accounting", ["Some(Estimated)"]),
                             ("args", ["different"]), ("scenario_source", "different")):
            other = copy.deepcopy(self.run)
            other["rows"][0][field] = value
            self.assertEqual(self.compare(other)[0], 2)
        other = copy.deepcopy(self.run)
        other["rows"] = []
        self.assertEqual(self.compare(other)[0], 2)
        other = copy.deepcopy(self.run)
        other.pop("schema")
        self.assertEqual(self.compare(other)[0], 2)

    def test_failed_part_is_run_regression(self):
        other = copy.deepcopy(self.run)
        other["rows"][0]["run_completed"] = False
        self.assertEqual(self.compare(other)[0], 1)


class IsolationTests(unittest.TestCase):
    def test_private_copy_is_signed_read_only_and_survives_cargo_replacement(self):
        with tempfile.TemporaryDirectory() as folder:
            source, private = Path(folder, "cargo-probe"), Path(folder, "private")
            source.write_bytes(b"harmless fixture, never executed")
            private.mkdir()
            def sign(script, destination):
                self.assertNotEqual(destination, str(source))
                with open(destination, "ab") as f:
                    f.write(b"fixture-signature")
                return type("Result", (), {"returncode": 0})()
            with patch.object(bench, "PROBE", str(source)), patch.object(bench, "sh", side_effect=sign), patch.object(bench, "check_signed", return_value=["fixture-signature"]):
                probe, digest, signature = bench.prepare_probe(str(private))
            source.write_bytes(b"replacement fixture")
            self.assertEqual(bench.file_id(probe), digest)
            self.assertEqual(signature, ["fixture-signature"])
            self.assertEqual(os.stat(probe).st_mode & 0o777, 0o500)
            self.assertNotEqual(bench.file_id(source), digest)

    def test_cargo_copy_race_is_rejected_before_signing(self):
        with tempfile.TemporaryDirectory() as folder:
            source, private = Path(folder, "cargo-probe"), Path(folder, "private")
            source.write_bytes(b"fixture")
            private.mkdir()
            with patch.object(bench, "PROBE", str(source)), patch.object(bench, "file_id", side_effect=["before", "changed"]), patch.object(bench, "sh") as sign, contextlib.redirect_stderr(io.StringIO()):
                with self.assertRaises(SystemExit):
                    bench.prepare_probe(str(private))
                sign.assert_not_called()

    def test_launch_uses_private_bytes_and_retains_fixture_log(self):
        with tempfile.TemporaryDirectory() as folder:
            probe = Path(folder, "private-probe")
            probe.write_bytes(b"harmless fixture, never executed")
            digest = bench.file_id(probe)
            def launch(command, **kwargs):
                self.assertEqual(command, [str(probe), "--live-lead", "explain"])
                self.assertNotEqual(command[0], bench.PROBE)
                kwargs["stdout"].write(summary())
                self.assertNotEqual(kwargs["cwd"], bench.REPO)
                return type("Child", (), {"wait": lambda self, **kw: 0})()
            with patch.object(bench.subprocess, "Popen", side_effect=launch):
                row = bench.run_one("explain", folder, str(probe), digest)
            self.assertTrue(row["run_completed"])
            self.assertTrue(row["probe_unchanged"])
            self.assertEqual(Path(row["log"]).read_text(), summary())
            self.assertIsNone(row["task_verified"])

    def test_target_directory_override(self):
        with patch.dict(os.environ, {"CARGO_TARGET_DIR": "/private/tmp/fixture-target", "WORK_BENCH_OUT": "/private/tmp/fixture-results"}):
            module = importlib.util.module_from_spec(spec)
            loader.exec_module(module)
            self.assertEqual(module.PROBE, "/private/tmp/fixture-target/debug/macos-terra-agentic-probe")
            self.assertEqual(module.OUT, "/private/tmp/fixture-results")


if __name__ == "__main__":
    unittest.main()
