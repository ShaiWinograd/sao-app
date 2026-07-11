# 5. Quotations

## Quotation ownership

A quotation belongs to a project, not to a job.

A quotation may be created when:

- No dates are known
- Only some dates are known
- All dates are known
- No calendar jobs exist yet

## Quotation tab

Show:

- Current version
- Status
- Created date
- Sent date
- Approval date
- Valid-until date
- Estimated total
- Included services
- Date precision

Date precision:

- Exact dates
- Partial dates
- Expected month
- Date range
- Dates to be determined

## Main actions

Depending on status:

- Create quotation
- Edit quotation
- Preview quotation
- Send by WhatsApp
- Send by email
- Copy sharing link
- Download
- Record approval
- Create new version
- Create addendum
- Mark rejected
- Mark expired

## Preview

Clearly show when dates are not final.

Examples:

```text
מועד משוער: ינואר 2027
```

```text
המועדים המדויקים יתואמו בהמשך ובהתאם לזמינות.
```

## Sending

Record:

- Sent time
- Channel
- Recipient
- Quotation version
- Sender

Supported channels:

- WhatsApp
- Email
- Manual download/share
- Mark sent manually

## Approval

Action:

```text
תיעוד אישור לקוח
```

Fields:

- Approved version
- Approval date
- Approval method
- Notes
- Optional attachment or screenshot

Approval methods:

- Digital approval
- Signed document
- WhatsApp
- Email
- Verbal approval
- Manual entry

## Version history

For each version show:

- Version number
- Creation date
- Status
- Total
- Sent channel
- Approval state
- Replacement version

Approved versions are immutable.

Editing approved scope creates:

- New quotation version, or
- Quotation addendum

## Status behavior

After approval:

- No jobs scheduled → מאושר – מחכה לקביעת תאריכים
- Some required work scheduled → מאושר – תזמון חלקי
- All required work scheduled → מאושר לביצוע

## Quotation changes after approval

When adding work, ask:

```text
האם העבודה החדשה דורשת עדכון להצעת המחיר?
```

Options:

- No update required
- Create revised quotation
- Create addendum

Keep the original approved version in history.
