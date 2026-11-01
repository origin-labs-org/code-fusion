"""Harmless fabricated fixtures; no network, signing, native app, or model calls."""
import copy
import importlib.machinery
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest import mock

loader = importlib.machinery.SourceFileLoader('work_eval', str(Path(__file__).with_name('work-eval')))
spec = importlib.util.spec_from_loader(loader.name, loader)
eval = importlib.util.module_from_spec(spec)
loader.exec_module(eval)


def fixture():
    link = {'extraction_id': 'fixture', 'source_id': 1}
    task = {'id': 'fixture', 'urls': ['https://example.test/facts'], 'grading': 'deterministic', 'predicates': [{'id': 'p1'}]}
    model = {'model': {'provider': 'open_ai', 'model': eval.MODEL}}
    source = {'id': 'source', 'published': False, 'data': {'kind': 'findings'}, 'evidence': [link]}
    answer = {'id': 'answer', 'published': True, 'data': {'kind': 'code', 'language': 'json', 'text': '{"title":"Fixture Title","count":3}'}, 'evidence': [link]}
    step = {'id': 'read', 'kind': 'read', 'status': 'succeeded', 'url': task['urls'][0], 'artifacts': ['source'], 'measurements': {'planner_calls': 2, 'outcome': {'kind': 'completed'}}}
    evidence = {'schema_version': 1, 'case_id': 'fixture', 'public_artifacts': 'exported', 'models': {role: copy.deepcopy(model) for role in ('lead', 'page', 'light')},
                'wall_ms': 10, 'model_calls': [{'state': 'settled'}, {'state': 'unsettled'}], 'executions': [{'status': 'needs_review', 'steps': [step], 'artifacts': [source, answer],
                'attempts': [{'status': 'succeeded', 'usage': {'model_tokens': 10, 'cost_micro_usd': 20, 'accounting': 'conservative_reservation'}}]}]}
    return task, evidence, {'state': 'ready', 'expected': {'title': 'Fixture Title', 'count': 3}}, {'excluded_domains': ['tuned.test']}


class GradingTests(unittest.TestCase):
    def test_task_pass_requires_values_and_native_source_links(self):
        task, evidence, reference, manifest = fixture()
        self.assertEqual(eval.grade(task, evidence, reference, manifest)['task_outcome'], 'passed')
        evidence['executions'][0]['status'] = 'failed'
        self.assertEqual(eval.grade(task, evidence, reference, manifest)['task_outcome'], 'passed', 'operational and semantic outcomes are separate')
        evidence['executions'][0]['artifacts'][1]['data']['text'] = '{"title":"Wrong","count":3}'
        self.assertEqual(eval.grade(task, evidence, reference, manifest)['task_outcome'], 'failed')

    def test_success_objects_without_verified_values_do_not_pass(self):
        task, evidence, reference, manifest = fixture()
        evidence['executions'][0]['artifacts'][1]['data']['text'] = 'I finished it successfully.'
        self.assertEqual(eval.grade(task, evidence, reference, manifest)['task_outcome'], 'failed')
        task['grading'] = 'source_audit'
        self.assertEqual(eval.grade(task, evidence, reference, manifest)['task_outcome'], 'unknown')

    def test_missing_or_unrelated_source_evidence_fails(self):
        for mutation in ('url', 'read_status', 'link'):
            task, evidence, reference, manifest = fixture()
            if mutation == 'url': evidence['executions'][0]['steps'][0]['url'] = 'https://different.test/facts'
            if mutation == 'read_status': evidence['executions'][0]['steps'][0]['status'] = 'failed'
            if mutation == 'link': evidence['executions'][0]['artifacts'][1]['evidence'] = []
            self.assertEqual(eval.grade(task, evidence, reference, manifest)['task_outcome'], 'failed')

    def test_unrelated_published_object_cannot_supply_answer_provenance(self):
        task, evidence, reference, manifest = fixture()
        artifacts = evidence['executions'][0]['artifacts']
        unrelated = copy.deepcopy(artifacts[0])
        unrelated.update(id='unrelated', published=True)
        artifacts.append(unrelated)
        artifacts[1]['evidence'] = []
        self.assertEqual(eval.grade(task, evidence, reference, manifest)['task_outcome'], 'failed')

    def test_revision_inherits_publication_but_not_old_correctness_or_citations(self):
        task, evidence, reference, manifest = fixture()
        artifacts = evidence['executions'][0]['artifacts']
        for artifact in artifacts:
            artifact['revises'] = None
        revised = copy.deepcopy(artifacts[1])
        revised.update(id='revised', revises='answer', published=False)
        revised['data']['text'] = '{"title":"Wrong","count":3}'
        artifacts.append(revised)
        self.assertEqual(eval.grade(task, evidence, reference, manifest)['task_outcome'], 'failed')
        revised['data']['text'] = artifacts[1]['data']['text']
        self.assertEqual(eval.grade(task, evidence, reference, manifest)['task_outcome'], 'passed')
        revised['evidence'] = []
        self.assertEqual(eval.grade(task, evidence, reference, manifest)['task_outcome'], 'failed')

    def test_ambiguous_legacy_answers_and_broken_revision_history_stay_unknown(self):
        task, evidence, reference, manifest = fixture()
        artifacts = evidence['executions'][0]['artifacts']
        second = copy.deepcopy(artifacts[1])
        second['id'] = 'second'
        artifacts.append(second)
        self.assertEqual(eval.grade(task, evidence, reference, manifest)['reason'], 'legacy_artifact_revisions_unknown')
        for artifact in artifacts:
            artifact['revises'] = None
        second['revises'] = 'missing'
        self.assertEqual(eval.grade(task, evidence, reference, manifest)['reason'], 'invalid_artifact_revision_history')
        second['revises'] = 'answer'
        artifacts[1]['revises'] = 'second'
        self.assertEqual(eval.grade(task, evidence, reference, manifest)['reason'], 'invalid_artifact_revision_history')

    def test_private_wrong_model_and_tuned_contamination_stay_unknown(self):
        for mutation in ('private', 'model', 'tuned', 'case'):
            task, evidence, reference, manifest = fixture()
            if mutation == 'private': evidence['public_artifacts'] = 'withheld_private_provenance'
            if mutation == 'model': evidence['models']['page']['model']['model'] = 'other'
            if mutation == 'tuned': evidence['executions'][0]['steps'][0]['url'] = 'https://www.tuned.test/facts'
            if mutation == 'case': evidence['case_id'] = 'other'
            self.assertEqual(eval.grade(task, evidence, reference, manifest)['task_outcome'], 'unknown')

    def test_exact_keys_and_scalar_types(self):
        task, evidence, reference, manifest = fixture()
        for text in ('{"title":"Fixture Title","count":"3"}', '{"title":"Fixture Title","count":3,"extra":1}', '{"title":"Fixture Title"}'):
            evidence['executions'][0]['artifacts'][1]['data']['text'] = text
            self.assertEqual(eval.grade(task, evidence, reference, manifest)['task_outcome'], 'failed')

    def test_internal_refusals_remain_visible_after_correct_task_result(self):
        _, evidence, _, _ = fixture()
        log = 'lead-run: event=ObjectRefused { reason: Some(ReplyMarkup) }\n' * 2
        metrics = eval.metrics(evidence, log)
        self.assertEqual(metrics['object_refusal_reasons'], {'ReplyMarkup': 2})
        self.assertEqual(metrics['reported_cost_micro_usd'], 20)
        self.assertEqual(metrics['accounting_bases'], ['conservative_reservation'])
        self.assertEqual(metrics['selected_model_call_attempts'], 2)
        self.assertEqual(metrics['unsettled_model_calls'], 1)
        self.assertEqual(metrics['page_model_calls'], 2)

    def test_missing_calls_are_unknown_and_emulation_is_not_added_twice(self):
        self.assertIsNone(eval.metrics({}, '')['selected_model_call_attempts'])
        _, evidence, _, _ = fixture()
        evidence['executions'][0]['steps'][0]['measurements'].update(decision_calls=2,emulation_calls=1)
        row=eval.metrics(evidence,'')
        self.assertEqual(row['selected_model_call_attempts'],2)
        self.assertEqual(row['primary_decision_calls'],2)
        self.assertEqual(row['emulation_calls_overlapping_selected_client'],1)

    def test_missing_usage_is_unknown_not_zero(self):
        _, evidence, _, _ = fixture()
        evidence['executions'][0]['attempts'][0]['usage'] = None
        self.assertIsNone(eval.metrics(evidence, '')['reported_cost_micro_usd'])


class ReferenceAndFreezeTests(unittest.TestCase):
    def test_reference_extraction_is_independent_json_and_html(self):
        source = {'format': 'json', 'fields': {'count': {'path': ['items'], 'transform': 'length'}}}
        self.assertEqual(eval.reference_fields(source, b'{"items":[1,2]}'), {'count': 2})
        source = {'format': 'html_meta', 'fields': {'title': {'path': ['citation_title', 0]}, 'authors': {'path': ['citation_author'], 'transform': 'length'}}}
        body = b'<meta name="citation_title" content="Fixture"><meta name="citation_author" content="A"><meta name="citation_author" content="B">'
        self.assertEqual(eval.reference_fields(source, body), {'title': 'Fixture', 'authors': 2})

    def test_private_files_are_exclusive_and_0600(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder, 'evidence.json')
            eval.write_private(path, {'fixture': True})
            self.assertEqual(path.stat().st_mode & 0o777, 0o600)
            with self.assertRaises(FileExistsError): eval.write_private(path, {'overwritten': True})
            self.assertEqual(eval.read_json(path), {'fixture': True})

    def test_manifest_excludes_all_23_tuned_cases_and_recipe_travel_hosts(self):
        manifest = eval.load_manifest(Path(__file__).parent.parent / 'eval/work-heldout-v1.json')
        self.assertEqual(len(manifest['tasks']), 100)
        self.assertEqual(len(manifest['tuned_cases']), 23)
        self.assertIn('unsplash', {case['id'] for case in manifest['tuned_cases']})
        self.assertEqual(sum(task['eligibility'] == 'eligible_public' for task in manifest['tasks']), 70)
        for url in ('https://www.ebay.com/', 'https://unsplash.com/s/photos/other', 'https://www.kayak.com/', 'https://flights.google.com/'):
            self.assertTrue(eval.excluded(url, manifest))
        self.assertFalse(eval.excluded('https://not-ebay.com/', manifest))

    def test_summary_does_not_count_pending_or_manual_as_passes(self):
        _, evidence, _, _ = fixture()
        rows = [{'id': 'fixture', 'eligibility': 'eligible_public', 'exit': 0, 'process_completed': True, 'process_ms': 10, 'task_outcome': 'unknown', 'metrics': eval.metrics(evidence, '')},
                {'id': 'account', 'eligibility': 'pending_user_session', 'task_outcome': 'pending'}]
        summary = eval.summarize(rows)
        self.assertEqual(summary['verified_passes_of_attempted'], '0/1')
        self.assertEqual(summary['process_completions'], 1)


    def test_matrix_parser_preserves_exact_pairs_and_refuses_omissions(self):
        manifest = eval.load_manifest(eval.DEFAULT_MANIFEST)
        lines = ['url[' + row['id'] + ']="' + row['url'] + '"; goal[' + row['id'] + ']="' + row['goal'] + '"' for row in manifest['tuned_cases']]
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'matrix.sh'
            path.write_text('\n'.join(lines) + '\n# This source is never executed.\n')
            self.assertEqual(eval.matrix_pairs(path), manifest['tuned_cases'])
            path.write_text('\n'.join(lines[:-1]))
            with self.assertRaises(ValueError): eval.matrix_pairs(path)
            path.write_text('\n'.join(lines + [lines[0]]))
            with self.assertRaises(ValueError): eval.matrix_pairs(path)

    def test_tuned_matrix_is_explicit_exact_and_never_automatic_pass(self):
        manifest = eval.load_manifest(eval.DEFAULT_MANIFEST)
        self.assertIs(eval.evaluation_manifest(manifest, {}), manifest)
        derived = eval.evaluation_manifest(manifest, {'evaluation_lane': 'tuned_matrix_v1'})
        self.assertEqual(len(derived['tasks']), 23)
        self.assertIn('unsplash', {task['id'] for task in derived['tasks']})
        self.assertTrue(manifest['excluded_domains'])
        for case, task in zip(manifest['tuned_cases'], derived['tasks']):
            self.assertEqual(task['urls'], [case['url']])
            self.assertEqual(task['original_goal'], case['goal'])
            self.assertTrue(task['prompt'].endswith(case['goal']))
            self.assertEqual(task['grading'], 'source_audit')
        _, evidence, _, _ = fixture()
        task = derived['tasks'][0]
        evidence['case_id'] = task['id']
        self.assertEqual(eval.grade(task, evidence, None, derived)['task_outcome'], 'unknown')
        self.assertEqual(len(manifest['tasks']), 100)

    def test_summary_distributions_keep_unknowns_basis_and_censored_time_explicit(self):
        _, evidence, _, _ = fixture()
        rows = []
        for index in range(10):
            measured = eval.metrics(evidence, '')
            measured.update(reported_cost_micro_usd=index if index < 8 else None,
                            selected_model_call_attempts=index if index < 9 else None,
                            wall_ms=index * 2 if index < 7 else None,
                            accounting_bases=['exact' if index < 5 else 'conservative_reservation'])
            rows.append(dict(id=str(index), eligibility='eligible_public', exit=0,
                             process_completed=True, process_ms=index + 1,
                             timed_out=index == 9, task_outcome='unknown', metrics=measured))
        rows.append(dict(id='pending', eligibility='pending_user_session', task_outcome='pending'))
        summary = eval.summarize(rows)
        reports = summary['distributions']
        self.assertEqual(reports['reported_cost_micro_usd']['median'], 3.5)
        self.assertEqual(reports['reported_cost_micro_usd']['unknown_runs'], 2)
        self.assertEqual(reports['selected_client_calls']['median'], 4)
        self.assertEqual(reports['process_latency_ms']['p90'], 9)
        self.assertEqual(reports['work_wall_latency_ms']['p90'], 12)
        self.assertEqual(reports['work_wall_latency_ms']['unknown_runs'], 3)
        self.assertTrue(all(report['excluded_unattempted_runs'] == 1 for report in reports.values()))
        self.assertEqual(summary['latency_qualification']['timed_out_runs'], 1)
        self.assertEqual(summary['reported_cost_by_accounting_basis']['exact']['median'], 2)
        self.assertEqual(summary['reported_cost_by_accounting_basis']['conservative_reservation']['unknown_runs'], 2)
        self.assertIsNone(eval.distribution([])['p90'])


class FormOracleTests(unittest.TestCase):
    def receipt(self, checks, **changes):
        row = {"version": 1, "case": "form-selenium-controls", "reason": "observed", "checks": checks, "content_exported": False}
        row.update(changes)
        return "form-oracle: " + json.dumps(row) + "\n"

    def grade(self, log):
        return eval.grade_form({"id": "form-selenium-controls"}, {"case_id": "form-selenium-controls", "public_artifacts": "exported"}, log)

    def effects(self, **changes):
        row = {"version":1,"native_actions_started":2,"native_actions_settled":2,
               "native_commits_applied":0,"incomplete":False,
               "navigation":{"callbacks":2,"accepted_main_forms":0,"accepted_subframe_forms":0,
                             "post_initial_main":0,"consent_navigation":0,"initial_finished":True,"uncertain":False},
               "no_task_submit_or_navigation":True,"fill_then_clear":False,"fill_then_increment_once":False}
        row.update(changes)
        return row

    def settled_receipt(self, checks, effects=None, event=True, task="form-selenium-controls"):
        effects = effects or self.effects()
        return self.receipt(checks, case=task, effects=effects, no_task_submit_event=event) + "form-effects: " + json.dumps({"version":1,"case":task,"effects":effects,"content_exported":False}) + "\n"

    def test_complete_native_effects_and_submit_event_qualify_exact_p2(self):
        self.assertEqual(self.grade(self.settled_receipt([True,True,True]))['task_outcome'], 'passed')
        self.assertEqual(self.grade(self.settled_receipt([True,True,True],event=False))['predicates'][1]['state'], 'failed')
        self.assertEqual(self.grade(self.settled_receipt([True,True,True],event=None))['predicates'][1]['state'], 'unknown')
        commit = self.effects(native_commits_applied=1,no_task_submit_or_navigation=False)
        self.assertEqual(self.grade(self.settled_receipt([True,True,True],effects=commit))['task_outcome'], 'failed')
        for changes in ({"incomplete":True}, {"native_actions_settled":1}, {"native_actions_started":257}):
            self.assertEqual(self.grade(self.settled_receipt([True,True,True],effects=self.effects(**changes)))['predicates'][1]['state'], 'unknown')
        missing = self.receipt([True,True,True],effects=self.effects(),no_task_submit_event=True)
        self.assertEqual(self.grade(missing)['predicates'][1]['state'], 'unknown')
        self.assertEqual(self.grade(self.settled_receipt([True,True,True])+missing)['task_outcome'], 'unknown')

    def test_unique_action_resource_requires_all_page_receipts_and_exact_stamps(self):
        readonly = self.effects(native_actions_started=0,native_actions_settled=0)
        def page(checks, effects, stamp, event=True):
            oracle=self.receipt(checks, effects=effects, no_task_submit_event=event,
                                document=f"WorkDocumentStamp {{ native_id: NavigationId({stamp}), epoch: 1 }}", profile="synthetic-profile")
            return oracle+"form-effects: "+json.dumps({"version":1,"case":"form-selenium-controls","effects":effects,"content_exported":False})+"\n"
        initial=page([False,False,True],readonly,1)
        action=page([True,True,True],self.effects(),2)
        result=self.grade(initial+action)
        self.assertEqual(result['task_outcome'],'passed')
        self.assertEqual(result['form_resource_selection'],'unique_action_page_with_every_opened_page_accounted')
        self.assertEqual(self.grade(initial+page([True,True,True],self.effects(),2,event=None))['task_outcome'],'unknown')
        self.assertEqual(self.grade(page([False,False,True],readonly,1,event=False)+action)['task_outcome'],'failed')
        for log in (action+page([True,True,True],self.effects(),3),
                    initial+page([True,True,True],self.effects(),1),
                    initial+action.split('form-effects: ')[0],
                    initial+page([True,True,True],self.effects(incomplete=True,no_task_submit_or_navigation=None),2),
                    initial+page([True,True,True],readonly,2)):
            self.assertEqual(self.grade(log)['task_outcome'],'unknown')

    def test_sequence_needs_target_bound_settled_history(self):
        for task, checks, field in (("form-expand-inputs",[True,True,None],"fill_then_clear"),
                                    ("form-heroku-numeric",[True,None],"fill_then_increment_once")):
            evidence={"case_id":task,"public_artifacts":"exported"}
            log=self.settled_receipt(checks, self.effects(**{field:True}), task=task)
            self.assertEqual(eval.grade_form({"id":task},evidence,log)['task_outcome'],'passed')
            log=self.settled_receipt(checks, self.effects(**{field:False}), task=task)
            self.assertEqual(eval.grade_form({"id":task},evidence,log)['task_outcome'],'failed')
            log=self.settled_receipt(checks, self.effects(incomplete=True,no_task_submit_or_navigation=None,**{field:True}), task=task)
            self.assertEqual(eval.grade_form({"id":task},evidence,log)['task_outcome'],'unknown')

    def test_correct_final_values_are_not_network_non_submission_proof(self):
        row = self.grade(self.receipt([True, True, True]))
        self.assertEqual(row['predicates'][0]['state'], 'passed')
        self.assertEqual(row['predicates'][1]['state'], 'unknown')
        self.assertEqual(row['task_outcome'], 'unknown')

    def test_fresh_wrong_value_fails_but_stale_or_multiple_pages_stay_unknown(self):
        self.assertEqual(self.grade(self.receipt([True, False, True]))['task_outcome'], 'failed')
        for log in (self.receipt([True, False, True], reason='stale_document'),
                    self.receipt([True, True, True]) + self.receipt([True, False, True]),
                    self.receipt(None, reason='timed_out'), ''):
            self.assertEqual(self.grade(log)['task_outcome'], 'unknown')

    def test_unknown_sequence_and_malformed_payload_never_pass(self):
        self.assertEqual(self.grade(self.receipt([True, None, True]))['predicates'][0]['state'], 'unknown')
        for checks in ([True], [True, 'true', True], [True, 1, True]):
            self.assertEqual(self.grade(self.receipt(checks))['task_outcome'], 'unknown')
        self.assertEqual(self.grade(self.receipt([True, True, True], content_exported=True))['task_outcome'], 'unknown')


class LocalFixtureTests(unittest.TestCase):
    def fixture(self, blocks=False):
        task={"id":"blocks-checklist" if blocks else "local-json-edit", "category":"blocks-fixture" if blocks else "local-fixture",
              "predicates":[{"id":key} for key in ("p1","p2","p3")]}
        base={"schema_version":1,"case_id":task["id"],"manifest_sha256":"frozen","frozen_case":task}
        setup=dict(base)
        evidence=dict(base, models={role:{"model":{"provider":"open_ai","model":"gpt-6-luna"}} for role in ("lead","page","light")},
                      status="completed", predicates={key:True for key in ("p1","p2","p3")})
        if blocks:
            setup.update(target_seeded=False,fixture_appendix_sha256="appendix",sentinel_id="owned",sentinel_sha256="before")
            evidence.update(fixture_appendix_sha256="appendix",sentinel={"id":"owned","before_sha256":"before","after_sha256":"before"})
        else:
            setup.update(input_hashes={"TASK.md":"input"},expected_changes=[{"path":"settings.json","after_sha256":"after"}])
            evidence.update(input_hashes=setup['input_hashes'],expected_changes=setup['expected_changes'])
        return task,evidence,setup

    def test_exact_setup_and_typed_predicates_are_required(self):
        task,evidence,setup=self.fixture()
        self.assertEqual(eval.grade_local(task,evidence,setup,'frozen')['task_outcome'],'passed')
        for patch in ({"status":"running"},{"case_id":"other"},{"expected_changes":[]},{"predicates":{"p1":True,"p2":"true","p3":True}}):
            changed=dict(evidence,**patch)
            self.assertEqual(eval.grade_local(task,changed,setup,'frozen')['task_outcome'],'unknown')
        evidence['predicates']['p2']=None
        self.assertEqual(eval.grade_local(task,evidence,setup,'frozen')['task_outcome'],'unknown')
        evidence['predicates']['p3']=False
        self.assertEqual(eval.grade_local(task,evidence,setup,'frozen')['task_outcome'],'failed')

    def test_blocks_never_substitute_seeded_targets_or_freeform_time_for_typed_zone(self):
        task,evidence,setup=self.fixture(True)
        self.assertEqual(eval.grade_local(task,evidence,setup,'frozen')['task_outcome'],'passed')
        setup['target_seeded']=True
        self.assertEqual(eval.grade_local(task,evidence,setup,'frozen')['task_outcome'],'unknown')
        setup['target_seeded']=False
        task['id']='blocks-calendar'
        evidence['case_id']=setup['case_id']=task['id']
        self.assertEqual(eval.grade_local(task,evidence,setup,'frozen')['reason'],'unsupported_typed_timezone_cannot_pass')
        evidence['predicates']['p2']=None
        self.assertEqual(eval.grade_local(task,evidence,setup,'frozen')['task_outcome'],'unknown')

    def test_missing_or_truncated_local_calls_and_unexported_primary_counts_are_unknown(self):
        self.assertIsNone(eval.local_metrics({},'')['selected_model_call_attempts'])
        evidence={"diagnostics":{"selected_client_calls":[{"state":"settled"}],"truncated":True,"attempt_usage":[None]}}
        row=eval.local_metrics(evidence,'')
        self.assertIsNone(row['selected_model_call_attempts'])
        self.assertEqual(row['observed_selected_client_calls'],1)
        self.assertIsNone(row['primary_decision_calls'])
        self.assertIsNone(row['reported_cost_micro_usd'])


class FixtureCleanupTests(unittest.TestCase):
    def setup_fixture(self, home):
        task={"id":"local-json-edit","category":"local-fixture"}
        root=home/'zephium-work-fixture-Abc123'
        root.mkdir(mode=0o700)
        (root/'docs').mkdir()
        (root/'TASK.md').write_text('synthetic task\n')
        (root/'docs'/'source.txt').write_text('synthetic source\n')
        identity=lambda path:{"device":path.stat().st_dev,"inode":path.stat().st_ino,"uid":path.stat().st_uid}
        setup={"schema_version":1,"case_id":task['id'],"manifest_sha256":"frozen","frozen_case":task,
               "input_hashes":{path:eval.digest(root/path) for path in ('TASK.md','docs/source.txt')},"expected_changes":[],
               "cleanup":{"kind":"owned_home_child_v1","home_basename":root.name,"mode":0o700,
                          "root_identity":identity(root),"parent_identity":identity(home)}}
        return task,setup,root

    def clean(self, task, setup, home, reaped=True):
        return eval.cleanup_local_fixture(task,setup,'frozen',reaped=reaped,home=home)

    def test_reap_required_then_only_exact_owned_tree_is_removed(self):
        with tempfile.TemporaryDirectory() as temp:
            home=Path(temp);task,setup,root=self.setup_fixture(home)
            sentinel=home/'unrelated.txt';sentinel.write_text('keep')
            self.assertEqual(self.clean(task,setup,home,False),'refused_not_reaped')
            self.assertTrue(root.exists())
            self.assertEqual(self.clean(task,setup,home),'removed')
            self.assertFalse(root.exists())
            self.assertEqual(sentinel.read_text(),'keep')
            self.assertEqual(self.clean(task,setup,home),'already_missing')

    def test_replaced_root_or_parent_never_falls_back_to_discovery(self):
        with tempfile.TemporaryDirectory() as temp:
            home=Path(temp);task,setup,root=self.setup_fixture(home)
            root.rename(home/'retained-original')
            root.mkdir(mode=0o700);(root/'personal.txt').write_text('must remain')
            self.assertEqual(self.clean(task,setup,home),'refused_root_identity')
            self.assertEqual((root/'personal.txt').read_text(),'must remain')
            setup['cleanup']['parent_identity']['inode']+=1
            self.assertEqual(self.clean(task,setup,home),'refused_parent_identity')

    def test_child_symlink_or_unexpected_content_is_refused_before_any_delete(self):
        with tempfile.TemporaryDirectory() as temp:
            home=Path(temp);task,setup,root=self.setup_fixture(home)
            outside=home/'outside.txt';outside.write_text('private')
            (root/'link').symlink_to(outside)
            self.assertEqual(self.clean(task,setup,home),'refused_tree')
            self.assertTrue((root/'TASK.md').exists());self.assertEqual(outside.read_text(),'private')
            (root/'link').unlink();(root/'TASK.md').write_text('unexpected new data')
            self.assertEqual(self.clean(task,setup,home),'refused_tree')
            self.assertTrue((root/'docs'/'source.txt').exists())

    def test_case_escape_and_root_symlink_are_refused_without_touching_target(self):
        with tempfile.TemporaryDirectory() as temp:
            home=Path(temp);task,setup,root=self.setup_fixture(home)
            bad=copy.deepcopy(setup);bad['case_id']='another'
            self.assertEqual(self.clean(task,bad,home),'refused_setup')
            bad=copy.deepcopy(setup);bad['cleanup']['home_basename']='../elsewhere'
            self.assertEqual(self.clean(task,bad,home),'refused_locator')
            saved=home/'retained';root.rename(saved);root.symlink_to(saved,target_is_directory=True)
            self.assertEqual(self.clean(task,setup,home),'refused_or_failed')
            self.assertTrue((saved/'TASK.md').exists())

    def test_in_place_change_after_preflight_is_not_deleted(self):
        with tempfile.TemporaryDirectory() as temp:
            home=Path(temp);task,setup,root=self.setup_fixture(home)
            original_stat=os.stat;changed=False;canonical_home=home.resolve()
            def mutate(path,*args,**kwargs):
                nonlocal changed
                if Path(path)==canonical_home and not changed:
                    changed=True
                    previous=original_stat(root/'TASK.md')
                    (root/'TASK.md').write_text('unknown changed content')
                    os.utime(root/'TASK.md',ns=(previous.st_atime_ns,previous.st_mtime_ns))
                return original_stat(path,*args,**kwargs)
            with mock.patch.object(os,'stat',side_effect=mutate):
                self.assertEqual(self.clean(task,setup,home),'refused_tree_changed')
            self.assertEqual((root/'TASK.md').read_text(),'unknown changed content')
            self.assertTrue((root/'docs'/'source.txt').exists())

    def test_root_replacement_after_preflight_preserves_both_trees(self):
        with tempfile.TemporaryDirectory() as temp:
            home=Path(temp);task,setup,root=self.setup_fixture(home)
            original_stat=os.stat;changed=False;retained=home/'retained-owned';canonical_home=home.resolve()
            def replace(path,*args,**kwargs):
                nonlocal changed
                if Path(path)==canonical_home and not changed:
                    changed=True;root.rename(retained);root.mkdir(mode=0o700)
                    (root/'personal.txt').write_text('keep')
                return original_stat(path,*args,**kwargs)
            with mock.patch.object(os,'stat',side_effect=replace):
                self.assertEqual(self.clean(task,setup,home),'refused_root_changed')
            self.assertEqual((retained/'TASK.md').read_text(),'synthetic task\n')
            self.assertEqual((root/'personal.txt').read_text(),'keep')

    def test_owned_run_finally_cleans_after_interrupt_and_integrity_failure(self):
        for interrupt in (True,False):
            with self.subTest(interrupt=interrupt), tempfile.TemporaryDirectory() as temp:
                home=Path(temp)/'home';home.mkdir();task,setup,fixture_root=self.setup_fixture(home)
                binary_root=Path(temp)/'binary';binary_root.mkdir();(binary_root/'probe').write_bytes(b'synthetic probe bytes')
                out=Path(temp)/'out';out.mkdir()
                frozen={'probe_sha256':eval.digest(binary_root/'probe'),'manifest_sha256':'frozen','timeout_seconds':1}
                class Child:
                    pid=12345
                    returncode=None
                    first=True
                    def poll(self):return self.returncode
                    def wait(self,timeout=None):
                        if self.first:
                            self.first=False
                            if interrupt:raise KeyboardInterrupt()
                            (binary_root/'probe').write_bytes(b'changed fake bytes')
                            self.returncode=0
                        return self.returncode
                child=Child()
                def spawn(command,**kwargs):
                    eval.write_private(Path(command[-1]).with_suffix('.freeze.json'),setup)
                    return child
                original_cleanup=eval.cleanup_local_fixture
                def cleanup(*args,**kwargs):return original_cleanup(*args,**kwargs,home=home)
                def stop(target):target.returncode=-15
                with mock.patch.object(eval.subprocess,'Popen',side_effect=spawn), mock.patch.object(eval,'stop_child',side_effect=stop), mock.patch.object(eval,'cleanup_local_fixture',side_effect=cleanup):
                    with self.assertRaises(KeyboardInterrupt if interrupt else ValueError):
                        eval.run_local_case(binary_root,frozen,task,out)
                receipt=json.loads((out/task['id']/'cleanup.json').read_text())
                self.assertTrue(receipt['child_reaped']);self.assertEqual(receipt['result'],'removed')
                self.assertFalse(fixture_root.exists())

    def test_already_exited_child_is_still_reaped(self):
        child=mock.Mock(pid=12345)
        with mock.patch.object(os,'killpg',side_effect=ProcessLookupError):
            eval.stop_child(child)
        child.wait.assert_called_once_with()




class RepeatedEvaluationTests(unittest.TestCase):
    def test_v2_keeps_original_public_tasks_and_contextual_followups(self):
        original = eval.load_manifest(eval.DEFAULT_MANIFEST)
        expanded = eval.load_manifest(eval.ROOT / "eval/work-heldout-v2.json")
        self.assertEqual(len(expanded['tasks']), 150)
        self.assertEqual(expanded['tasks'][:70], [task for task in original['tasks'] if task['eligibility'] == 'eligible_public'])
        followups = [task for task in expanded['tasks'] if task.get('follow_ups')]
        self.assertEqual(len(followups), 5)
        for task in followups:
            self.assertEqual(eval.task_request(task).splitlines(), [task['prompt'], task['follow_ups'][0]['prompt']])

    def test_reliability_counts_every_attempt_and_never_treats_unknown_as_success(self):
        def run(outcomes):
            _, evidence, _, _ = fixture()
            return {'run_id':eval.uuid.uuid4().hex, 'freeze_sha256':'same', 'rows':[{'id':str(i), 'eligibility':'eligible_public', 'exit':0, 'process_completed':True, 'process_ms':10, 'task_outcome':outcome, 'metrics':eval.metrics(evidence, '')} for i,outcome in enumerate(outcomes)]}
        runs = [run(['passed','passed','partial','unknown']), run(['passed','failed','passed','passed']), run(['passed','passed','passed','passed'])]
        report = eval.reliability(runs)
        self.assertEqual(report['pass_at_1'], .5)
        self.assertEqual(report['pass_power_3'], .25)
        self.assertEqual(report['ungraded_attempts'], 1)
        self.assertFalse(report['fully_graded'])
        runs[2]['freeze_sha256']='other'
        with self.assertRaises(ValueError): eval.reliability(runs)

    def test_round_rejects_missing_and_duplicate_tasks(self):
        a={'freeze_sha256':'same','rows':[{'id':'a','eligibility':'eligible_public','task_outcome':'pending'}]}
        with self.assertRaises(ValueError): eval.reliability([a,a,{'freeze_sha256':'same','rows':[]}])
        with self.assertRaises(ValueError): eval.reliability([a,a,{'freeze_sha256':'same','rows':a['rows']*2}])

    def test_same_attempt_cannot_be_copied_into_three_successes(self):
        one = {'run_id':'a'*32, 'freeze_sha256':'same', 'rows':[]}
        with self.assertRaises(ValueError): eval.reliability([one, copy.deepcopy(one), copy.deepcopy(one)])


class TimingTests(unittest.TestCase):
    def test_parallel_model_and_page_intervals_are_not_double_counted(self):
        evidence={'timeline':{'started_ms':0,'finished_ms':100},'model_calls':[{'started_ms':10,'finished_ms':40},{'started_ms':30,'finished_ms':60}], 'page_intervals':[{'started_ms':20,'finished_ms':80}]}
        result=eval.timing(evidence, '[ 80ms] lead-run: event=PartEnded { helper: Browser }\n[ 90ms] lead-run: event=Ended { status: Succeeded }')
        self.assertEqual([result[k] for k in ('model_busy_ms','page_without_model_ms','other_ms')], [50,20,30])
        self.assertEqual(result['post_browser_finalization_gaps_ms'], [10])
        evidence['wall_ms']=150
        self.assertIsNone(eval.timing(evidence,'')['model_busy_ms'], 'clock-origin mismatch must not silently omit setup time')

    def test_unfinished_timing_is_unknown_and_followups_reset_finalization(self):
        self.assertIsNone(eval.timing({'timeline':{'started_ms':0,'finished_ms':100}, 'model_calls':[{'started_ms':10}]}, '')['model_busy_ms'])
        log='[ 5ms] lead-run: event=PartEnded { helper: Browser }\n[ 9ms] lead-run: event=Ended {}\n[ 15ms] lead-run: event=Ended {}'
        self.assertEqual(eval.timing({}, log)['post_browser_finalization_gaps_ms'], [4])


class CostAndPartialTests(unittest.TestCase):
    def test_partial_never_passes_and_unknown_never_becomes_partial(self):
        state=lambda *values: eval.predicate_outcome([{'state':value} for value in values])
        self.assertEqual(state('partial','passed'), 'partial')
        self.assertEqual(state('partial','unknown'), 'unknown')
        self.assertEqual(state('partial','failed'), 'failed')
        with self.assertRaises(ValueError): state()

    def test_cost_target_refuses_unobserved_search_or_decision_cost(self):
        _, evidence, _, _=fixture()
        evidence['model_calls']=[{'state':'settled','cost_micro_usd':31}]
        self.assertEqual(eval.metrics(evidence,'')['cost_for_target_micro_usd'],31)
        evidence['executions'][0]['steps'][0]['measurements']['decision_calls']=1
        self.assertIsNone(eval.metrics(evidence,'')['cost_for_target_micro_usd'])
        evidence['executions'][0]['steps'][0]['measurements']['decision_calls']=0
        evidence['executions'][0]['steps'][0]['kind']='search'
        self.assertIsNone(eval.metrics(evidence,'')['cost_for_target_micro_usd'])


class ActionFrequencyTests(unittest.TestCase):
    def test_internal_repairs_are_counted_as_turns_and_old_logs_are_not_zero(self):
        _, evidence, _, _=fixture()
        self.assertIsNone(eval.metrics(evidence,'')['malformed_action_events'])
        evidence['page_diagnostics_version']=1
        counts=eval.metrics(evidence,'page-model: event=ModelAskedAgain(1)\npage-model: event=ModelActionRejected(Action)')
        self.assertEqual(counts['page_agent_turns'],3)
        self.assertEqual(counts['malformed_action_events'],1)
        self.assertAlmostEqual(counts['malformed_actions_per_100_page_turns'],100/3)


class PilotMeasurementTests(unittest.TestCase):
    def test_inline_page_finalization_is_counted_without_borrowing_a_prior_execution(self):
        evidence={'page_intervals':[{'started_ms':1,'finished_ms':5}]}
        log='[ 9ms] lead-run: event=Ended {}\n[ 15ms] lead-run: event=Ended {}'
        self.assertEqual(eval.timing(evidence,log)['post_browser_finalization_gaps_ms'],[4])

    def test_partial_fields_do_not_raise_pass_rate_or_hide_missing_provenance(self):
        task,evidence,reference,manifest=fixture()
        manifest['suite']='work-heldout-v2'
        evidence['executions'][0]['artifacts'][1]['data']['text']='{"title":"Wrong","count":3}'
        self.assertEqual(eval.grade(task,evidence,reference,manifest)['task_outcome'],'partial')
        evidence['executions'][0]['steps'][0]['status']='failed'
        self.assertEqual(eval.grade(task,evidence,reference,manifest)['task_outcome'],'failed')


class CanonicalMetadataSourceTests(unittest.TestCase):
    def test_only_the_predeclared_single_source_oracle_can_substitute_for_page_provenance(self):
        task,evidence,reference,manifest=fixture()
        manifest['suite']='work-heldout-v2'
        task['oracle']={'sources':{'metadata':{'url':'https://example.test/api/release-1'}}}
        step=evidence['executions'][0]['steps'][0]
        step['url']='https://example.test/api/release-1'
        self.assertEqual(eval.grade(task,evidence,reference,manifest)['task_outcome'],'passed')
        step['url']='https://example.test/api/release-2'
        self.assertEqual(eval.grade(task,evidence,reference,manifest)['task_outcome'],'failed')
        step['url']='https://example.test/api/release-1'
        manifest['suite']='work-heldout-v1'
        self.assertEqual(eval.grade(task,evidence,reference,manifest)['task_outcome'],'failed', 'historical grading remains immutable')


class SourceAuditBindingTests(unittest.TestCase):
    def test_audit_cannot_be_transferred_between_repetitions(self):
        row = {"evidence_sha256": "a" * 64, "log_sha256": "b" * 64}
        entry = dict(row, root_cause="missing_record_values")
        eval.validate_source_audit_binding(entry, row)
        for key in row:
            other = dict(row, **{key: "c" * 64})
            with self.assertRaises(ValueError):
                eval.validate_source_audit_binding(entry, other)
        with self.assertRaises(ValueError):
            eval.validate_source_audit_binding(dict(entry, evidence_sha256=None), dict(row, evidence_sha256=None))

    def test_audit_preserves_a_bounded_cause_and_quality_notes(self):
        row = {"evidence_sha256": "a" * 64, "log_sha256": "b" * 64}
        for cause in (None, "", "none\n", "a" * 81, "https://example.test/private"):
            with self.assertRaises(ValueError):
                eval.validate_source_audit_binding(dict(row, root_cause=cause), row)
        with self.assertRaises(ValueError):
            eval.validate_source_audit_binding(dict(row, root_cause="none", quality_notes="not a list"), row)
        eval.validate_source_audit_binding(dict(row, root_cause="none", quality_notes=["Answer is correct; native shutdown remains unproven."]), row)

    def test_answer_grade_does_not_hide_native_process_failure(self):
        _, evidence, _, _ = fixture()
        row = {"id": "fixture", "eligibility": "eligible_public", "exit": 1, "process_completed": False,
               "process_ms": 10, "task_outcome": "passed", "metrics": eval.metrics(evidence, ""),
               "root_cause": "cleanup_unproven", "review": {"type": "agent_source_audit"}}
        summary = eval.summarize([row])
        self.assertEqual(summary["verified_passes_of_attempted"], "1/1")
        self.assertEqual(summary["process_completions"], 0)
        self.assertEqual(summary["source_audit_root_causes"], {"cleanup_unproven": 1})


class FinalizationProfileTests(unittest.TestCase):
    def test_inline_read_after_a_browser_part_is_the_last_browser_work(self):
        evidence = {"timeline": {"started_ms": 0, "finished_ms": 20}, "wall_ms": 20,
                    "page_intervals": [{"started_ms": 6, "finished_ms": 10}],
                    "model_calls": [{"started_ms": 9, "finished_ms": 13}, {"started_ms": 12, "finished_ms": 17}]}
        log = "[ 5ms] lead-run: event=PartEnded { helper: Browser }\n[ 14ms] lead-run: event=ReplyPublished {}\n[ 20ms] lead-run: event=Ended {}"
        value = eval.timing(evidence, log)
        self.assertEqual(value["post_browser_finalization_gaps_ms"], [10])
        self.assertEqual(value["finalization_windows"], [{"last_browser_ms": 10, "ended_ms": 20, "first_reply_ms": 14,
                         "first_reply_relative_to_last_browser_ms": 4, "model_busy_ms": 7, "non_model_ms": 3}])

    def test_early_reply_is_not_reused_for_a_followup_or_claimed_as_final_answer(self):
        evidence = {"page_intervals": [{"started_ms": 3, "finished_ms": 5}, {"started_ms": 12, "finished_ms": 15}]}
        log = "[ 2ms] lead-run: event=ReplyPublished {}\n[ 9ms] lead-run: event=Ended {}\n[ 19ms] lead-run: event=Ended {}"
        windows = eval.timing(evidence, log)["finalization_windows"]
        self.assertEqual(windows[0]["first_reply_relative_to_last_browser_ms"], -3)
        self.assertIsNone(windows[1]["first_reply_ms"])
        self.assertIsNone(windows[0]["model_busy_ms"], "missing timing remains unknown")


if __name__ == '__main__':
    unittest.main()
