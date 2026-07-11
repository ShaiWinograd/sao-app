# 10. Pricing, Payment, and Reports

# Hours and pricing

## Comparison

Show:

- Estimated
- Scheduled
- Actual

Example:

| Service | Estimated | Scheduled | Actual |
|---|---:|---:|---:|
| Packing | 40 | 40 | 42.5 |
| Unpacking | 25 | 25 | — |
| Total | 65 | 65 | 42.5 |

## Customer pricing summary

Show:

- Quotation estimate
- Scheduled estimate
- Actual billable hours
- Fixed fees
- Supplies
- Discounts
- Final amount
- Review state

## Worker payment summary

Show aggregate totals in the project.

Detailed worker payments are available only to authorized administrators.

Worker pay may include:

- Hourly wage
- Fixed daily payment
- Bonus
- Customer-referral compensation
- Other approved additions

## Final review

Before finalization show:

```text
הסכום הסופי עדיין דורש בדיקה
```

Possible reasons:

- Attendance correction pending
- Missing form
- Manual pricing rule
- Additional work not covered
- Discount not confirmed

Primary action:

```text
בדיקת הסכום הסופי
```

# Payment tracking

## Stages

```text
עבודה הסתיימה
→ מחכה לחיוב
→ מחכה לתשלום
→ שולם
```

## External billing

The app does not create invoices.

Action:

```text
סימון כחויב במערכת החיצונית
```

Fields:

- Billing date
- External document number, optional
- Amount billed
- Notes

## Customer payment

Action:

```text
סימון כתשלום שהתקבל
```

Fields:

- Payment date
- Amount received
- Payment method
- Notes

Support partial payments if needed.

## Payment alerts

- Waiting for billing
- Payment due soon
- Payment overdue
- Partial payment
- Amount mismatch

# Reports

## Main reports

- Monthly business summary
- Worker report
- Customer/project report
- Job report
- Attendance exceptions
- Customer payment tracking
- Worker payment tracking

## Monthly summary

Show:

- Projects
- Jobs
- Worker-hours
- Estimated revenue
- Actual revenue
- Worker payment total
- Outstanding customer payments
- Attendance issues

## Worker report

Filters:

- Month
- Worker
- Project
- Job type

Show:

- Workdays
- Hours
- Fixed daily payments
- Bonuses
- Total due
- Payment status

## Project report

Show:

- Customer
- Planned work
- Scheduled work
- Actual hours
- Customer total
- Worker costs
- Payment status
- Forms
- Attendance issues
