# 6. Scheduling and Calendar

# Scheduling flow

## Main action

Use business wording:

- קביעת עבודות
- תזמון ימי עבודה

## Scope comparison

Show:

- Estimated work
- Scheduled work
- Remaining work

Example:

```text
אריזה

משוער: 2 ימים
נקבע: יום אחד
נותר לתזמן: יום אחד
```

## Schedule options

- Schedule one day
- Schedule several days
- Copy existing day

For several days use an editable table:

| Date | Time | Workers | Manager |
|---|---|---:|---|
| 3.8.2026 | 09:00–14:00 | 4 | Required |
| 4.8.2026 | 09:00–14:00 | 4 | Required |

## Moving-project validation

- First unpacking date must be after the final packing date.
- Same-day packing and unpacking requires explicit confirmation and a reason.
- Partial scheduling is allowed.

After saving packing jobs show:

```text
ימי האריזה נשמרו.

האם תרצי לקבוע עכשיו גם את ימי הפריקה?
```

Actions:

- קביעת פריקה
- אחר כך

## Partial scheduling

Example:

- Packing scheduled
- Unpacking unscheduled

Project state:

```text
מאושר – תזמון חלקי
```

Do not block saving.

# Worker availability finder

## Purpose

Support customer conversations about possible dates.

Action:

```text
מציאת תאריך פנוי
```

## Inputs

- Job type
- Required workers
- Manager required
- Number of manager positions
- Duration
- Date range
- Allowed weekdays
- Preferred start time

## Results

Order candidate dates by suitability.

Example:

```text
3.8.2026

8 עובדים זמינים
2 מנהלי עבודה זמינים

מתאים
```

Availability states:

- Available
- Already assigned
- Unavailable
- Awaiting response
- Not manager-qualified
- Not eligible for job type

Result actions:

- Select date
- Compare dates
- Temporarily reserve date
- Create project with selected date
- Add to existing project

# Calendar

## Views

- Month
- Week
- Day
- Worker availability

## Calendar job card

Show:

- Time
- Job type
- Customer
- Assigned/required workers
- Manager state
- Project approval state

Example:

```text
09:00–14:00

אריזה – משפחת כהן

3 מתוך 4 עובדים

חסר מנהל עבודה
```

## Visual states

Distinguish through text, icon, badge, and styling:

- Draft
- Reserved
- Approved
- Published
- Fully staffed
- In progress
- Awaiting attendance review
- Completed
- Cancelled

Do not rely only on color.

## Filters

- Job type
- Project status
- Job status
- Worker
- Manager missing
- Worker shortage
- Customer
- Location
- Draft/published

## Day details

Clicking a day shows:

- All jobs
- Worker capacity
- Available managers
- Unassigned workers
- Scheduling warnings
