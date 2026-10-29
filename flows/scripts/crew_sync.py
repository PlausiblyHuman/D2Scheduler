"""Builder for D2 - Crew Sync.

Rebuilds the Assignments.Crew Choice list AND its validation formula from every Crews row whenever
a Crews row is created or modified (the SharePoint GetOnUpdatedItems trigger fires on creates too).
Runs as D2 Bot through the SharePoint connection.

Never writes SchemaXml: that clobbers choices and silently wipes ValidationFormula. The MERGE sends
Choices, ValidationFormula and ValidationMessage only.

Proven 2026-10-29 on a throwaway list ("ZZ Merge Probe", deleted) through the proxy flow. This exact
request, with Content-Type application/json;odata=verbose, X-HTTP-Method MERGE and If-Match *, returned
success (the proxy reports the 204 as 200 with an empty body):

  {"__metadata":{"type":"SP.FieldChoice"},
   "Choices":{"__metadata":{"type":"Collection(Edm.String)"},"results":["a","b","c"]},
   "ValidationFormula":"=OR(ISBLANK([X]),[X]=\\"a\\",[X]=\\"b\\",[X]=\\"c\\")",
   "ValidationMessage":"m"}

Read-back: Choices ["a","b","c"], ValidationMessage "m", and ValidationFormula
=OR(ISBLANK(X),X="a",X="b",X="c"). SharePoint STRIPS THE BRACKETS when it stores a formula, and the
live Assignments.Crew formula reads back the same way (Crew="antonio"), so Guard_written looks for
Crew="code" (and tolerates [Crew]="code").

Print the flow with: py -3 flows/scripts/crew_sync.py
"""
import json

SITE = 'https://netorgft15040037.sharepoint.com/sites/D2BuildScheduler'
CREWS_LIST = '45e9ff1f-bf36-4ab5-929d-25ab9a80d460'
FIELD_URI = "_api/web/lists/GetByTitle('Assignments')/fields/getbyinternalnameortitle('Crew')"
FIELD_READ = FIELD_URI + '?$select=Choices,ValidationFormula'
ALERT_TO = 'stratirus@d2pools.com'

SP_HOST = {
    'apiId': '/providers/Microsoft.PowerApps/apis/shared_sharepointonline',
    'operationId': 'HttpRequest',
    'connectionName': 'shared_sharepointonline',
}
MAIL_HOST = {
    'connectionName': 'shared_office365',
    'operationId': 'SendEmailV2',
    'apiId': '/providers/Microsoft.PowerApps/apis/shared_office365',
}

CHOICES_NOW = "length(coalesce(body('Get_crew_field')?['Choices'], json('[]')))"


def _get_field(after):
    return {
        'runAfter': {after: ['Succeeded']},
        'type': 'OpenApiConnection',
        'inputs': {
            'parameters': {
                'dataset': SITE,
                'parameters/method': 'GET',
                'parameters/uri': FIELD_READ,
                'parameters/headers': {'Accept': 'application/json;odata=nometadata'},
            },
            'host': dict(SP_HOST),
        },
    }


def _email(subject, body, after):
    return {
        'runAfter': after,
        'type': 'OpenApiConnection',
        'inputs': {
            'host': dict(MAIL_HOST),
            'parameters': {
                'emailMessage/To': ALERT_TO,
                'emailMessage/Subject': subject,
                'emailMessage/Body': body,
                'emailMessage/Importance': 'High',
            },
        },
    }


def _terminate(code, message, after):
    return {
        'runAfter': after,
        'type': 'Terminate',
        'inputs': {'runStatus': 'Failed', 'runError': {'code': code, 'message': message}},
    }


def build():
    bad_codes_where = (
        "@or(equals(item(), ''), not(equals(item(), toLower(item()))), "
        "contains(item(), ' '), contains(item(), '\"'))"
    )
    guard_codes_expr = (
        "@or(greater(length(body('Filter_bad_codes')), 0), "
        "less(length(body('Select_codes')), 1), "
        "less(length(body('Select_codes')), " + CHOICES_NOW + "))"
    )
    email_body_1 = (
        "<p>D2 - Crew Sync read the Crews list and did not touch Assignments.Crew.</p>"
        "<p>Codes read (@{length(body('Select_codes'))}): @{join(body('Select_codes'), ', ')}</p>"
        "<p>Bad codes: @{join(body('Filter_bad_codes'), ', ')}</p>"
        "<p>Choices on Assignments.Crew now: @{" + CHOICES_NOW + "}</p>"
        "<p>A code must be non-empty, lower case, with no spaces or quotes, and the list must not be "
        "shorter than the choices already on the column.</p>"
    )
    email_body_2 = (
        "<p>D2 - Crew Sync wrote the Assignments.Crew field and the read-back did not match.</p>"
        "<p>Codes read (@{length(body('Select_codes'))}): @{join(body('Select_codes'), ', ')}</p>"
        "<p>Missing after the write: @{join(body('Filter_missing_written'), ', ')}</p>"
        "<p>Choices on Assignments.Crew now: "
        "@{length(coalesce(body('Get_crew_field_after')?['Choices'], json('[]')))}</p>"
        "<p>Check the column in SharePoint and re-run sharepoint/guard-crew-values.js if needed.</p>"
    )
    missing_where = (
        "@or(not(contains(coalesce(body('Get_crew_field_after')?['Choices'], json('[]')), item())), "
        "not(or(contains(coalesce(body('Get_crew_field_after')?['ValidationFormula'], ''), "
        "concat('Crew=\"', item(), '\"')), "
        "contains(coalesce(body('Get_crew_field_after')?['ValidationFormula'], ''), "
        "concat('[Crew]=\"', item(), '\"')))))"
    )
    merge_body = (
        "@{string(setProperty(setProperty(setProperty("
        "json('{\"__metadata\":{\"type\":\"SP.FieldChoice\"}}'), "
        "'Choices', setProperty(json('{\"__metadata\":{\"type\":\"Collection(Edm.String)\"}}'), "
        "'results', body('Select_codes'))), "
        "'ValidationFormula', outputs('Compose_formula')), "
        "'ValidationMessage', outputs('Compose_message')))}"
    )
    message_expr = (
        "@concat('Crew must be one of the codes from the Crews list, lower case, no spaces: ', "
        "join(body('Select_codes'), ', '), "
        "'. Use the short code (devon), never the display name (Devon Crew +3). "
        "A code that is not on this list matches nothing: the row would be skipped by dispatch and "
        "by conflict detection, silently.')"
    )

    actions = {
        'Get_crews': {
            'runAfter': {},
            'type': 'OpenApiConnection',
            'inputs': {
                'parameters': {'dataset': SITE, 'table': CREWS_LIST, '$top': 500},
                'host': {
                    'apiId': '/providers/Microsoft.PowerApps/apis/shared_sharepointonline',
                    'operationId': 'GetItems',
                    'connectionName': 'shared_sharepointonline',
                },
            },
        },
        'Select_codes': {
            'runAfter': {'Get_crews': ['Succeeded']},
            'type': 'Select',
            'inputs': {
                'from': "@body('Get_crews')?['value']",
                'select': "@trim(coalesce(item()?['CrewID'], ''))",
            },
        },
        'Filter_bad_codes': {
            'runAfter': {'Select_codes': ['Succeeded']},
            'type': 'Query',
            'inputs': {'from': "@body('Select_codes')", 'where': bad_codes_where},
        },
        'Get_crew_field': _get_field('Filter_bad_codes'),
        'Guard_codes': {
            'runAfter': {'Get_crew_field': ['Succeeded']},
            'type': 'If',
            'expression': guard_codes_expr,
            'actions': {
                'Send_failure_email': _email(
                    'D2 Crew Sync stopped: crew codes not written', email_body_1, {}),
                'Terminate_bad_codes': _terminate(
                    'BadCrewCodes',
                    'The Crews list gave an empty, malformed or shrunken code list. '
                    'Nothing was written to Assignments.Crew.',
                    {'Send_failure_email': ['Succeeded']}),
            },
            'else': {'actions': {}},
        },
        'Select_formula_terms': {
            'runAfter': {'Guard_codes': ['Succeeded']},
            'type': 'Select',
            'inputs': {'from': "@body('Select_codes')", 'select': "@concat('[Crew]=\"', item(), '\"')"},
        },
        'Compose_formula': {
            'runAfter': {'Select_formula_terms': ['Succeeded']},
            'type': 'Compose',
            'inputs': "@concat('=OR(ISBLANK([Crew]),', join(body('Select_formula_terms'), ','), ')')",
        },
        'Compose_message': {
            'runAfter': {'Compose_formula': ['Succeeded']},
            'type': 'Compose',
            'inputs': message_expr,
        },
        'Merge_crew_field': {
            'runAfter': {'Compose_message': ['Succeeded']},
            'type': 'OpenApiConnection',
            'inputs': {
                'parameters': {
                    'dataset': SITE,
                    'parameters/method': 'POST',
                    'parameters/uri': FIELD_URI,
                    'parameters/headers': {
                        'X-HTTP-Method': 'MERGE',
                        'If-Match': '*',
                        'Content-Type': 'application/json;odata=verbose',
                        'Accept': 'application/json;odata=verbose',
                    },
                    'parameters/body': merge_body,
                },
                'host': dict(SP_HOST),
            },
        },
        'Get_crew_field_after': _get_field('Merge_crew_field'),
        'Filter_missing_written': {
            'runAfter': {'Get_crew_field_after': ['Succeeded']},
            'type': 'Query',
            'inputs': {'from': "@body('Select_codes')", 'where': missing_where},
        },
        'Guard_written': {
            'runAfter': {'Filter_missing_written': ['Succeeded']},
            'type': 'If',
            'expression': "@greater(length(body('Filter_missing_written')), 0)",
            'actions': {
                'Send_failure_email_2': _email(
                    'D2 Crew Sync: crew field not written as expected', email_body_2, {}),
                'Terminate_not_written': _terminate(
                    'CrewFieldNotWritten',
                    'After the MERGE, Assignments.Crew did not carry every crew code in both '
                    'its choices and its validation formula.',
                    {'Send_failure_email_2': ['Succeeded']}),
            },
            'else': {'actions': {}},
        },
    }

    definition = {
        '$schema': 'https://schema.management.azure.com/providers/Microsoft.Logic/schemas/2016-06-01/workflowdefinition.json#',
        'contentVersion': '1.0.0.0',
        'description': 'D2 - Crew Sync',
        'parameters': {
            '$connections': {'defaultValue': {}, 'type': 'Object'},
            '$authentication': {'defaultValue': {}, 'type': 'SecureObject'},
        },
        'triggers': {
            'When_a_crew_is_added_or_changed': {
                'recurrence': {'frequency': 'Minute', 'interval': 1},
                'type': 'OpenApiConnection',
                'inputs': {
                    'host': {
                        'connectionName': 'shared_sharepointonline',
                        'operationId': 'GetOnUpdatedItems',
                        'apiId': '/providers/Microsoft.PowerApps/apis/shared_sharepointonline',
                    },
                    'parameters': {'dataset': SITE, 'table': CREWS_LIST},
                },
            },
        },
        'actions': actions,
    }

    connection_references = {
        'shared_sharepointonline': {
            'connectionName': 'shared-sharepointonl-20b83f29-d689-437e-b1ff-930f7bf3fda4',
            'connectionReferenceLogicalName': 'new_sharedsharepointonline_beb06',
            'source': 'Embedded',
            'id': '/providers/Microsoft.PowerApps/apis/shared_sharepointonline',
            'displayName': 'SharePoint',
            'tier': 'Standard',
            'apiName': 'sharepointonline',
        },
        'shared_office365': {
            'connectionName': 'shared-office365-0bc14d33-bf94-4439-bdbc-d600759333d5',
            'connectionReferenceLogicalName': 'new_sharedoffice365_4d59e',
            'source': 'Embedded',
            'id': '/providers/Microsoft.PowerApps/apis/shared_office365',
            'displayName': 'Office 365 Outlook',
            'tier': 'Standard',
            'apiName': 'office365',
        },
    }
    return {'definition': definition, 'connectionReferences': connection_references}


if __name__ == '__main__':
    print(json.dumps(build(), ensure_ascii=True, indent=1))
