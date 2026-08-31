/* SCHEMAS — the 12 CSV input files the dashboard understands.
   Single source for: the client-side parser/validator, the downloadable blank
   templates (with example rows), the data dictionary, and the mock generator.
   Types: id | text | date (DD-MM-YYYY) | month (MM-YYYY) | int | num | pct (0–100)
        | flag (Y/N) | enum (allowed values listed). */

const ENUMS = {
  asset: CONFIG.assets,
  gradeBand: CONFIG.gradeBands,
  gender: ['Female', 'Male', 'Other'],
  employeeClass: ['Permanent', 'Trainee'],
  exitType: ['Voluntary', 'Involuntary'],
  reqType: ['New', 'Replacement'],
  closureMode: ['Internal', 'External', 'Campus', 'Boomerang'],
  appStatus: ['Applied', 'Shortlisted', 'Interviewed', 'Offered', 'Rejected', 'Withdrawn'],
  learnMode: ['Classroom', 'E-learning'],
  learnCategory: ['Technical/Functional', 'Behavioural', 'HSE', 'Induction', 'Compliance'],
  completionStatus: ['Completed', 'In Progress'],
  positionLevel: ['GM', 'CP'],
  readiness: ['Ready Now', '1-2 Years'],
  direction: ['higher', 'lower'],
  flag: ['Y', 'N']
};

const SCHEMAS = {
  employee_master: {
    label: 'Employee master',
    desc: 'One row per on-roll employee. Include employees who exited during the history window (their exits are matched from exits.csv by Employee ID) so trends and attrition can be computed.',
    keyColumn: 'employee_id',
    columns: [
      { name: 'Employee ID', key: 'employee_id', type: 'id', required: true, desc: 'Unique employee identifier', ex: ['AMNS-HZ-00135', 'AMNS-PD-00072', 'AMNS-VZ-00018'] },
      { name: 'Name', key: 'name', type: 'text', required: false, desc: 'Display name (use dummy names; the dashboard never needs real ones)', ex: ['A. Sharma', 'R. Patel', 'S. Rao'] },
      { name: 'Asset', key: 'asset', type: 'enum', enum: 'asset', required: true, desc: 'Operating asset / site', ex: ['Hazira', 'Paradeep', 'Vizag'] },
      { name: 'Grade Band', key: 'grade_band', type: 'enum', enum: 'gradeBand', required: true, desc: 'Grade band', ex: ['AM-GM', 'Below AM', 'VP & above'] },
      { name: 'Grade', key: 'grade', type: 'text', required: false, desc: 'Grade code within band', ex: ['DGM', 'S2', 'VP'] },
      { name: 'Function', key: 'function', type: 'text', required: true, desc: 'Function / department', ex: ['Operations', 'Maintenance', 'Finance'] },
      { name: 'Gender', key: 'gender', type: 'enum', enum: 'gender', required: true, desc: 'Gender', ex: ['Male', 'Female', 'Female'] },
      { name: 'DOB', key: 'dob', type: 'date', required: true, desc: 'Date of birth (drives superannuation metrics)', ex: ['14-03-1982', '02-11-1990', '23-07-1975'] },
      { name: 'Date of Joining', key: 'doj', type: 'date', required: true, desc: 'Date of joining', ex: ['01-04-2015', '15-07-2021', '09-01-2008'] },
      { name: 'Employee Class', key: 'employee_class', type: 'enum', enum: 'employeeClass', required: true, desc: 'Permanent or Trainee (contract workforce comes from contract files)', ex: ['Permanent', 'Trainee', 'Permanent'] },
      { name: 'TT Flag', key: 'tt_flag', type: 'flag', required: false, desc: 'Identified as Top Talent (Y/N)', ex: ['N', 'Y', 'N'] },
      { name: 'CT Flag', key: 'ct_flag', type: 'flag', required: false, desc: 'Identified as Critical Talent (Y/N)', ex: ['N', 'N', 'Y'] },
      { name: 'Critical Position Flag', key: 'cp_flag', type: 'flag', required: false, desc: 'Occupies a Critical Position (Y/N)', ex: ['N', 'Y', 'N'] },
      { name: 'Manager ID', key: 'manager_id', type: 'text', required: false, desc: 'Employee ID of the line manager (drives span of control)', ex: ['AMNS-HZ-00021', 'AMNS-PD-00003', 'AMNS-VZ-00002'] },
      { name: 'Nationality', key: 'nationality', type: 'text', required: false, desc: 'Nationality (drives international workforce %)', ex: ['Indian', 'Indian', 'Japanese'] },
      { name: 'Disability Flag', key: 'disability_flag', type: 'flag', required: false, desc: 'Person with disability (Y/N)', ex: ['N', 'N', 'N'] },
      { name: 'Current Role Start Date', key: 'role_start', type: 'date', required: false, desc: 'Start date in current role (drives stagnation metrics)', ex: ['01-04-2021', '15-07-2021', '01-10-2019'] },
      { name: 'Last Promotion Date', key: 'last_promotion', type: 'date', required: false, desc: 'Most recent promotion date (blank = never promoted)', ex: ['01-04-2021', '', '01-10-2019'] }
    ]
  },

  exits: {
    label: 'Exits',
    desc: 'One row per separation in the history window. Employee ID should exist in the employee master.',
    keyColumn: 'employee_id',
    columns: [
      { name: 'Employee ID', key: 'employee_id', type: 'id', required: true, desc: 'Employee who exited', ex: ['AMNS-HZ-00135', 'AMNS-PD-00072', 'AMNS-KD-00311'] },
      { name: 'Exit Date', key: 'exit_date', type: 'date', required: true, desc: 'Last working day', ex: ['18-05-2025', '02-01-2025', '27-11-2024'] },
      { name: 'Exit Type', key: 'exit_type', type: 'enum', enum: 'exitType', required: true, desc: 'Voluntary or Involuntary (superannuation handled separately)', ex: ['Voluntary', 'Involuntary', 'Voluntary'] },
      { name: 'Regretted Flag', key: 'regretted_flag', type: 'flag', required: false, desc: 'Business regrets the exit (Y/N)', ex: ['Y', 'N', 'Y'] },
      { name: 'OK-to-Rehire Flag', key: 'rehire_flag', type: 'flag', required: false, desc: 'Tagged OK to rehire (Y/N)', ex: ['Y', 'N', 'Y'] },
      { name: 'Exit Reason', key: 'exit_reason', type: 'text', required: false, desc: 'Primary stated reason (blank rows are surfaced in Data Quality)', ex: ['Better prospects', 'Performance', 'Relocation'] }
    ]
  },

  requisitions: {
    label: 'Requisitions',
    desc: 'One row per hiring requisition (open or closed) for the permanent roll.',
    keyColumn: 'requisition_id',
    columns: [
      { name: 'Requisition ID', key: 'requisition_id', type: 'id', required: true, desc: 'Unique requisition identifier', ex: ['REQ-2024-0113', 'REQ-2025-0027', 'REQ-2025-0031'] },
      { name: 'Asset', key: 'asset', type: 'enum', enum: 'asset', required: true, desc: 'Hiring asset', ex: ['Hazira', 'Vizag', 'Paradeep'] },
      { name: 'Grade', key: 'grade', type: 'text', required: false, desc: 'Grade of the position', ex: ['DGM', 'GM', 'S1'] },
      { name: 'Function', key: 'function', type: 'text', required: false, desc: 'Function / department', ex: ['Operations', 'Projects', 'HR'] },
      { name: 'Open Date', key: 'open_date', type: 'date', required: true, desc: 'Requisition approval date', ex: ['05-02-2025', '20-03-2025', '11-04-2025'] },
      { name: 'Type', key: 'req_type', type: 'enum', enum: 'reqType', required: false, desc: 'New position or replacement', ex: ['Replacement', 'New', 'Replacement'] },
      { name: 'Posted Internally Flag', key: 'posted_flag', type: 'flag', required: false, desc: 'Posted on the internal job portal (Y/N)', ex: ['Y', 'Y', 'N'] },
      { name: 'Confidential Flag', key: 'confidential_flag', type: 'flag', required: false, desc: 'Confidential search — exempt from internal posting (Y/N)', ex: ['N', 'N', 'Y'] },
      { name: 'Closed Date', key: 'closed_date', type: 'date', required: false, desc: 'Blank if still open', ex: ['28-04-2025', '', '30-05-2025'] },
      { name: 'Closure Mode', key: 'closure_mode', type: 'enum', enum: 'closureMode', required: false, desc: 'How the position was filled', ex: ['Internal', '', 'External'] },
      { name: 'Hired Employee ID', key: 'hired_employee_id', type: 'text', required: false, desc: 'Employee ID of the hire (if closed)', ex: ['AMNS-HZ-00892', '', 'AMNS-PD-00417'] }
    ]
  },

  internal_applications: {
    label: 'Internal applications',
    desc: 'One row per application on the internal job portal.',
    keyColumn: 'application_id',
    columns: [
      { name: 'Application ID', key: 'application_id', type: 'id', required: true, desc: 'Unique application identifier', ex: ['APP-05121', 'APP-05122', 'APP-05188'] },
      { name: 'Requisition ID', key: 'requisition_id', type: 'text', required: true, desc: 'Requisition applied to', ex: ['REQ-2024-0113', 'REQ-2024-0113', 'REQ-2025-0027'] },
      { name: 'Applicant Employee ID', key: 'employee_id', type: 'text', required: true, desc: 'Internal applicant', ex: ['AMNS-HZ-00245', 'AMNS-VZ-00082', 'AMNS-PD-00160'] },
      { name: 'Application Date', key: 'application_date', type: 'date', required: true, desc: 'Date applied', ex: ['10-02-2025', '12-02-2025', '25-03-2025'] },
      { name: 'Status', key: 'status', type: 'enum', enum: 'appStatus', required: true, desc: 'Current stage', ex: ['Interviewed', 'Rejected', 'Applied'] },
      { name: 'Last Action Date', key: 'last_action_date', type: 'date', required: false, desc: 'Date of last recruiter action (drives the >15-day ageing flag)', ex: ['01-03-2025', '20-02-2025', '25-03-2025'] }
    ]
  },

  learning_events: {
    label: 'Learning events',
    desc: 'One row per employee per learning programme attended. Category, completion, feedback and cost columns are optional but unlock the L&D depth metrics.',
    columns: [
      { name: 'Employee ID', key: 'employee_id', type: 'id', required: true, desc: 'Participant', ex: ['AMNS-HZ-00135', 'AMNS-KD-00088', 'AMNS-VZ-00018'] },
      { name: 'Programme', key: 'programme', type: 'text', required: true, desc: 'Programme name', ex: ['Safety Leadership', 'Data Analytics Basics', 'First-time Manager'] },
      { name: 'Start Date', key: 'start_date', type: 'date', required: true, desc: 'Programme start date', ex: ['12-05-2025', '03-06-2025', '21-04-2025'] },
      { name: 'Person-Days', key: 'person_days', type: 'num', required: true, desc: 'Training person-days for this participant', ex: ['2', '0.5', '3'] },
      { name: 'Mode', key: 'mode', type: 'enum', enum: 'learnMode', required: false, desc: 'Classroom or E-learning', ex: ['Classroom', 'E-learning', 'Classroom'] },
      { name: 'Category', key: 'category', type: 'enum', enum: 'learnCategory', required: false, desc: 'Programme category (drives HSE/compliance coverage metrics)', ex: ['HSE', 'Technical/Functional', 'Behavioural'] },
      { name: 'Completion Status', key: 'completion', type: 'enum', enum: 'completionStatus', required: false, desc: 'Completed or In Progress', ex: ['Completed', 'Completed', 'In Progress'] },
      { name: 'Feedback Score', key: 'feedback', type: 'num', required: false, desc: 'Participant feedback, 1–5', ex: ['4.5', '4', ''] },
      { name: 'Cost', key: 'cost', type: 'num', required: false, desc: 'Cost attributed to this participant (₹)', ex: ['8000', '1500', '12000'] }
    ]
  },

  idp_status: {
    label: 'IDP status',
    desc: 'Individual Development Plan status for eligible employees (Top Talent + VP & above).',
    keyColumn: 'employee_id',
    columns: [
      { name: 'Employee ID', key: 'employee_id', type: 'id', required: true, desc: 'Eligible employee', ex: ['AMNS-HZ-00245', 'AMNS-PD-00003', 'AMNS-VZ-00002'] },
      { name: 'IDP on System Flag', key: 'idp_flag', type: 'flag', required: true, desc: 'IDP recorded on the system (Y/N)', ex: ['Y', 'Y', 'N'] },
      { name: 'IDP Implementation %', key: 'idp_pct', type: 'pct', required: false, desc: '0–100 implementation of agreed actions', ex: ['45', '20', ''] },
      { name: 'Last Updated', key: 'last_updated', type: 'date', required: false, desc: 'Last update to the IDP (stale dates are surfaced in Data Quality)', ex: ['15-04-2025', '02-09-2024', ''] }
    ]
  },

  succession: {
    label: 'Succession',
    desc: 'One row per successor mapping for GM-level and Critical Positions. Positions with no successor still get one row with successor fields blank.',
    columns: [
      { name: 'Position ID', key: 'position_id', type: 'id', required: true, desc: 'Position identifier', ex: ['POS-HZ-GM-012', 'POS-PD-CP-004', 'POS-VZ-GM-002'] },
      { name: 'Position Level', key: 'position_level', type: 'enum', enum: 'positionLevel', required: true, desc: 'GM-level or Critical Position', ex: ['GM', 'CP', 'GM'] },
      { name: 'Incumbent Employee ID', key: 'incumbent_id', type: 'text', required: false, desc: 'Blank = vacant position', ex: ['AMNS-HZ-00021', 'AMNS-PD-00003', ''] },
      { name: 'Successor Employee ID', key: 'successor_id', type: 'text', required: false, desc: 'Blank = no identified successor', ex: ['AMNS-HZ-00245', '', 'AMNS-VZ-00082'] },
      { name: 'Readiness', key: 'readiness', type: 'enum', enum: 'readiness', required: false, desc: 'Ready Now or 1-2 Years', ex: ['Ready Now', '', '1-2 Years'] },
      { name: 'Successor has IDP Flag', key: 'succ_idp_flag', type: 'flag', required: false, desc: 'Successor has an IDP on system (Y/N)', ex: ['Y', '', 'N'] }
    ]
  },

  lms_usage: {
    label: 'LMS usage',
    desc: 'One row per employee with a learning-platform licence.',
    keyColumn: 'employee_id',
    columns: [
      { name: 'Employee ID', key: 'employee_id', type: 'id', required: true, desc: 'Licensed employee', ex: ['AMNS-HZ-00135', 'AMNS-PD-00072', 'AMNS-KD-00311'] },
      { name: 'Licensed Flag', key: 'licensed_flag', type: 'flag', required: true, desc: 'Has an active licence (Y/N)', ex: ['Y', 'Y', 'Y'] },
      { name: 'Last Login Date', key: 'last_login', type: 'date', required: false, desc: 'Blank = never logged in', ex: ['22-06-2025', '10-01-2025', ''] }
    ]
  },

  targets: {
    label: 'Targets',
    desc: 'Optional targets per metric. Metric Key must match a registry key (see the data dictionary / Methodology tab). Metrics without a target row show "Target not set".',
    keyColumn: 'metric_key',
    columns: [
      { name: 'Metric Key', key: 'metric_key', type: 'id', required: true, desc: 'Registry key, e.g. attr_annualised', ex: ['attr_annualised', 'succession_coverage', 'learning_coverage_all'] },
      { name: 'Target Value', key: 'target_value', type: 'num', required: true, desc: 'Target in the metric’s own unit', ex: ['8', '80', '75'] },
      { name: 'Direction', key: 'direction', type: 'enum', enum: 'direction', required: true, desc: 'higher = higher is better; lower = lower is better', ex: ['lower', 'higher', 'higher'] }
    ]
  },

  production_safety: {
    label: 'Production & safety',
    desc: 'One row per asset per month. Drives productivity, cost and safety metrics.',
    columns: [
      { name: 'Asset', key: 'asset', type: 'enum', enum: 'asset', required: true, desc: 'Asset', ex: ['Hazira', 'Hazira', 'Paradeep'] },
      { name: 'Month', key: 'month', type: 'month', required: true, desc: 'Month (MM-YYYY)', ex: ['04-2025', '05-2025', '05-2025'] },
      { name: 'Crude Steel Tonnes', key: 'tonnes', type: 'num', required: false, desc: 'Crude steel production in tonnes', ex: ['612000', '598500', '71500'] },
      { name: 'Man-hours Worked', key: 'man_hours', type: 'num', required: false, desc: 'Total man-hours incl. contract (LTIFR base)', ex: ['3260000', '3190000', '860000'] },
      { name: 'Lost-Time Injuries', key: 'lti', type: 'int', required: false, desc: 'Lost-time injuries in the month', ex: ['1', '0', '0'] },
      { name: 'Man-days Lost to IR', key: 'ir_days', type: 'num', required: false, desc: 'Man-days lost to industrial-relations action', ex: ['0', '120', '0'] },
      { name: 'Employee Cost', key: 'employee_cost', type: 'num', required: false, desc: 'Employee cost for the month (₹)', ex: ['1480000000', '1495000000', '310000000'] },
      { name: 'Revenue', key: 'revenue', type: 'num', required: false, desc: 'Revenue for the month (₹)', ex: ['38200000000', '37600000000', '5400000000'] }
    ]
  },

  contract_attendance: {
    label: 'Contract attendance',
    desc: 'One row per contractor per asset per month. Source system: SCRUM.',
    source: 'SCRUM',
    columns: [
      { name: 'Contractor', key: 'contractor', type: 'text', required: true, desc: 'Contractor name/code', ex: ['CNT-Alpha', 'CNT-Baseline', 'CNT-Alpha'] },
      { name: 'Asset', key: 'asset', type: 'enum', enum: 'asset', required: true, desc: 'Asset', ex: ['Hazira', 'Hazira', 'Paradeep'] },
      { name: 'Month', key: 'month', type: 'month', required: true, desc: 'Month (MM-YYYY)', ex: ['05-2025', '05-2025', '05-2025'] },
      { name: 'Man-days Deployed', key: 'mandays_deployed', type: 'num', required: true, desc: 'Scheduled contractor man-days', ex: ['10400', '6200', '4100'] },
      { name: 'Man-days Present', key: 'mandays_present', type: 'num', required: true, desc: 'Actual man-days present', ex: ['9750', '5840', '3820'] },
      { name: 'Contract Headcount', key: 'contract_headcount', type: 'int', required: true, desc: 'Contract workers on roll in the month', ex: ['400', '238', '158'] }
    ]
  },

  contract_compliance: {
    label: 'Contract compliance',
    desc: 'One row per contractor per asset per month. Source system: Aparajita.',
    source: 'Aparajita',
    columns: [
      { name: 'Contractor', key: 'contractor', type: 'text', required: true, desc: 'Contractor name/code', ex: ['CNT-Alpha', 'CNT-Baseline', 'CNT-Alpha'] },
      { name: 'Asset', key: 'asset', type: 'enum', enum: 'asset', required: true, desc: 'Asset', ex: ['Hazira', 'Hazira', 'Paradeep'] },
      { name: 'Month', key: 'month', type: 'month', required: true, desc: 'Month (MM-YYYY)', ex: ['05-2025', '05-2025', '05-2025'] },
      { name: 'PF/ESI Remittance OK Flag', key: 'pf_esi_flag', type: 'flag', required: true, desc: 'Statutory remittances on time (Y/N)', ex: ['Y', 'Y', 'N'] },
      { name: 'Wage Payment On-Time Flag', key: 'wage_flag', type: 'flag', required: true, desc: 'Wages paid on time (Y/N)', ex: ['Y', 'N', 'Y'] },
      { name: 'Labour Licence Valid Flag', key: 'licence_flag', type: 'flag', required: true, desc: 'Labour licence valid for the month (Y/N)', ex: ['Y', 'Y', 'Y'] },
      { name: 'Safety Induction Coverage %', key: 'induction_pct', type: 'pct', required: true, desc: '% of deployed workers with valid safety induction', ex: ['96', '88', '92'] }
    ]
  },

  pms_status: {
    label: 'Performance management status',
    desc: 'One row per on-roll employee in the current performance cycle. Drives goal-setting and mid-year review completion metrics.',
    keyColumn: 'employee_id',
    columns: [
      { name: 'Employee ID', key: 'employee_id', type: 'id', required: true, desc: 'Employee in the cycle', ex: ['AMNS-HZ-00135', 'AMNS-PD-00072', 'AMNS-VZ-00018'] },
      { name: 'Goal Setting Complete Flag', key: 'goal_flag', type: 'flag', required: true, desc: 'Goals agreed and locked on the system (Y/N)', ex: ['Y', 'Y', 'N'] },
      { name: 'Mid-Year Review Complete Flag', key: 'midyear_flag', type: 'flag', required: false, desc: 'Mid-year review completed (Y/N)', ex: ['Y', 'N', 'N'] }
    ]
  },

  recognition: {
    label: 'Recognition awards',
    desc: 'One row per award given in the history window. Drives recognition coverage (unique employees recognised).',
    columns: [
      { name: 'Employee ID', key: 'employee_id', type: 'id', required: true, desc: 'Awarded employee', ex: ['AMNS-HZ-00135', 'AMNS-KD-00088', 'AMNS-HZ-00135'] },
      { name: 'Award Date', key: 'award_date', type: 'date', required: true, desc: 'Date of the award', ex: ['14-05-2025', '02-06-2025', '20-06-2025'] },
      { name: 'Award Name', key: 'award_name', type: 'text', required: false, desc: 'Award / recognition programme name', ex: ['Spot Award', 'Safety Champion', 'Quarterly Excellence'] }
    ]
  },

  wellbeing: {
    label: 'Wellbeing (aggregates)',
    desc: 'One row per asset per month, AGGREGATE COUNTS ONLY — no individual health or counselling data ever enters this dashboard.',
    columns: [
      { name: 'Asset', key: 'asset', type: 'enum', enum: 'asset', required: true, desc: 'Asset', ex: ['Hazira', 'Paradeep', 'Vizag'] },
      { name: 'Month', key: 'month', type: 'month', required: true, desc: 'Month (MM-YYYY)', ex: ['05-2025', '05-2025', '06-2025'] },
      { name: 'Counselling Sessions', key: 'sessions', type: 'int', required: true, desc: 'Counselling sessions held (aggregate count)', ex: ['42', '11', '9'] },
      { name: 'Unique Employees Counselled', key: 'unique_counselled', type: 'int', required: false, desc: 'Distinct employees who used counselling (aggregate count)', ex: ['25', '8', '6'] },
      { name: 'Distress Cases', key: 'distress', type: 'int', required: false, desc: 'Severe/distress cases escalated (aggregate count)', ex: ['0', '1', '0'] },
      { name: 'Wellness Programme Attendees', key: 'wellness_attendees', type: 'int', required: false, desc: 'Attendees at wellness sessions/webinars (aggregate count)', ex: ['180', '45', '60'] }
    ]
  }
};

const SCHEMA_IDS = Object.keys(SCHEMAS);
