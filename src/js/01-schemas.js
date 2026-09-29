/* SCHEMAS — the CSV input files the dashboard understands.
   Single source for: the client-side parser/validator, the downloadable blank
   templates (with example rows), the data dictionary, the mock generator and
   (via `aka` header synonyms) the field-mapping step.
   Types: id | text | date (DD-MM-YYYY) | month (MM-YYYY) | int | num | pct (0–100)
        | flag (Y/N) | enum (allowed values listed).
   `source` is the default source-system label per template (editable on the
   Field Mapping tab). Columns added in Phase 8 are optional unless required. */

const ENUMS = {
  asset: CONFIG.assets,
  gradeBand: CONFIG.gradeBands,
  segment: CONFIG.segments,
  mgmtBand: CONFIG.mgmtBands,
  gender: ['Female', 'Male', 'Other'],
  employeeClass: ['Permanent', 'Trainee'],
  hireType: ['Lateral', 'Campus', 'GET', 'Rehire'],
  exitType: ['Voluntary', 'Involuntary', 'Retirement'],
  exitReasonCategory: ['Career growth', 'Compensation', 'Work environment', 'Personal / family', 'Relocation',
    'Further studies', 'Health', 'Retirement', 'Performance', 'Termination / disciplinary', 'Absconding', 'Other'],
  reqType: ['New', 'Replacement'],
  reqStatus: ['Open', 'On Hold', 'Dropped', 'Offered', 'TBO', 'Closed'],
  closureMode: ['Internal', 'External', 'Campus', 'Boomerang'],
  appStatus: ['Applied', 'Shortlisted', 'Interviewed', 'Offered', 'Rejected', 'Withdrawn'],
  candidateStage: ['Applied', 'Screened', 'Interview', 'Offered', 'Offer Accepted', 'Joined', 'Dropped'],
  learnMode: ['Classroom', 'E-learning'],
  learnCategory: ['Technical/Functional', 'Behavioural', 'HSE', 'Induction', 'Compliance'],
  completionStatus: ['Completed', 'In Progress'],
  goalStatus: ['Not started', 'Draft', 'Submitted', 'Approved'],
  midYearStatus: ['Not started', 'Self-review done', 'Manager review done', 'Completed'],
  annualStatus: ['Not started', 'Self-appraisal done', 'Manager review done', 'Completed'],
  positionLevel: ['GM', 'CP'],
  positionStatus: ['Filled', 'Vacant', 'Frozen', 'On Hold'],
  movementType: ['Promotion', 'Transfer – Location', 'Transfer – Function', 'Transfer – Company', 'Re-designation', 'Segment Change'],
  readiness: ['Ready Now', '1-2 Years'],
  complianceStatus: ['On time', 'Late', 'Pending', 'Not applicable'],
  direction: ['higher', 'lower'],
  flag: ['Y', 'N']
};

// shared synonym lists (header names seen in HRMS / ATS / MIS exports)
const AKA = {
  empId: ['Emp ID', 'Employee Code', 'Emp Code', 'Employee No', 'Personnel Number', 'Staff ID'],
  // the HRMS detail reports (demographics, hiring, attrition) head the ID column
  // "Code" — matched exactly only (akaExact)
  empIdReport: ['Code'],
  asset: ['Location', 'Site', 'Plant Location', 'Work Location'],
  month: ['Period', 'Reporting Month', 'MM-YYYY'],
  func: ['Function 1', 'Department', 'Function Name', 'Dept'],
  plant: ['Function 2', 'Sub Function', 'Sub Department', 'Plant Unit', 'Department Unit', 'Section'],
  company: ['Legal Entity', 'Company Name', 'Entity', 'Company Code'],
  segment: ['Segment', 'Business', 'Business Type', 'Operations / Projects'],
  level: ['Grade Level', 'Job Level', 'Level Code', 'Pay Level'],
  reqId: ['Req ID', 'Req Code', 'Requisition Code', 'Job Requisition ID'],
  contractor: ['Vendor', 'Contractor Name', 'Vendor Code', 'Agency']
};

const SCHEMAS = {
  employee_master: {
    label: 'Employee master',
    source: 'HRMS',
    desc: 'One row per on-roll employee. Include employees who exited during the history window (their exits are matched from exits.csv by Employee ID) so trends and attrition can be computed.',
    keyColumn: 'employee_id',
    columns: [
      { name: 'Employee ID', key: 'employee_id', type: 'id', required: true, desc: 'Unique employee identifier', aka: AKA.empId, akaExact: AKA.empIdReport, ex: ['AMNS-HZ-00135', 'AMNS-PD-00072', 'AMNS-VZ-00018'] },
      { name: 'Name', key: 'name', type: 'text', required: false, desc: 'Display name (use dummy names; the dashboard never needs real ones)', aka: ['Employee Name', 'Full Name', 'Emp Name', 'Ename', 'E Name'], ex: ['A. Sharma', 'R. Patel', 'S. Rao'] },
      { name: 'Asset', key: 'asset', type: 'enum', enum: 'asset', required: true, desc: 'Operating asset / site', aka: AKA.asset, ex: ['Hazira', 'Paradeep', 'Vizag'] },
      { name: 'Grade Band', key: 'grade_band', type: 'enum', enum: 'gradeBand', required: true, desc: 'Grade band', aka: ['Grade Group', 'Band Group', 'Cadre'], ex: ['AM-GM', 'Below AM', 'VP & above'] },
      { name: 'Grade', key: 'grade', type: 'text', required: false, desc: 'Grade code within band', aka: ['Grade Code', 'Pay Grade', 'Designation Grade'], ex: ['DGM', 'S2', 'VP'] },
      { name: 'Function', key: 'function', type: 'text', required: true, desc: 'Function / department (Function 1)', aka: AKA.func, ex: ['Operations', 'Maintenance', 'Finance'] },
      { name: 'Gender', key: 'gender', type: 'enum', enum: 'gender', required: true, desc: 'Gender', aka: ['Sex'], ex: ['Male', 'Female', 'Female'] },
      { name: 'DOB', key: 'dob', type: 'date', required: true, desc: 'Date of birth (drives superannuation and generation metrics)', aka: ['Date of Birth', 'Birth Date', 'D.O.B'], ex: ['14-03-1982', '02-11-1990', '23-07-1975'] },
      { name: 'Date of Joining', key: 'doj', type: 'date', required: true, desc: 'Date of joining', aka: ['DOJ', 'Joining Date', 'Hire Date', 'Date Joined'], ex: ['01-04-2015', '15-07-2021', '09-01-2008'] },
      { name: 'Employee Class', key: 'employee_class', type: 'enum', enum: 'employeeClass', required: true, desc: 'Permanent or Trainee (contract workforce comes from contract files)', aka: ['Employee Category', 'Employment Type', 'Emp Category', 'Employee Group'], ex: ['Permanent', 'Trainee', 'Permanent'] },
      { name: 'TT Flag', key: 'tt_flag', type: 'flag', required: false, desc: 'Identified as Top Talent (Y/N)', aka: ['Top Talent', 'Top Talent Flag', 'TT'], ex: ['N', 'Y', 'N'] },
      { name: 'CT Flag', key: 'ct_flag', type: 'flag', required: false, desc: 'Identified as Critical Talent (Y/N)', aka: ['Critical Talent', 'Critical Talent Flag', 'CT'], ex: ['N', 'N', 'Y'] },
      { name: 'Critical Position Flag', key: 'cp_flag', type: 'flag', required: false, desc: 'Occupies a Critical Position (Y/N)', aka: ['CP Flag', 'Critical Position', 'Critical Role Flag'], ex: ['N', 'Y', 'N'] },
      { name: 'Manager ID', key: 'manager_id', type: 'text', required: false, desc: 'Employee ID of the line manager (drives the manager and span metrics)', aka: ['Reporting Manager ID', 'Manager Code', 'Supervisor ID', 'Line Manager ID', 'RM Code', 'Man Code'], ex: ['AMNS-HZ-00021', 'AMNS-PD-00003', 'AMNS-VZ-00002'] },
      { name: 'Nationality', key: 'nationality', type: 'text', required: false, desc: 'Nationality (drives international workforce %)', aka: ['Citizenship', 'Country of Nationality'], ex: ['Indian', 'Indian', 'Japanese'] },
      { name: 'Disability Flag', key: 'disability_flag', type: 'flag', required: false, desc: 'Person with disability (Y/N)', aka: ['PwD Flag', 'Person with Disability', 'Divyang Flag'], ex: ['N', 'N', 'N'] },
      { name: 'Current Role Start Date', key: 'role_start', type: 'date', required: false, desc: 'Start date in current role (drives stagnation metrics)', aka: ['Role Start Date', 'Date in Current Role', 'Current Position Start Date'], ex: ['01-04-2021', '15-07-2021', '01-10-2019'] },
      { name: 'Last Promotion Date', key: 'last_promotion', type: 'date', required: false, desc: 'Most recent promotion date (blank = never promoted)', aka: ['Promotion Date', 'Date of Last Promotion', 'Last Promoted On'], ex: ['01-04-2021', '', '01-10-2019'] },
      { name: 'Company', key: 'company', type: 'text', required: false, desc: 'Legal entity the employee is on the rolls of', aka: AKA.company, ex: ['Company A', 'Company A', 'Company C'] },
      { name: 'Function Plant', key: 'function_plant', type: 'text', required: false, desc: 'Plant / department unit within the function (joins to org_units.csv)', aka: AKA.plant, ex: ['Steel Making', 'Project Commissioning', 'Finance Shared Services'] },
      { name: 'Business Segment', key: 'business_segment', type: 'enum', enum: 'segment', required: false, desc: 'Operations or Projects (blank = resolved from org_units.csv by Function Plant)', aka: AKA.segment, ex: ['Operations', 'Projects', ''] },
      { name: 'Level', key: 'level', type: 'text', required: false, desc: 'Grade-ladder level (ordered by CONFIG.levels, e.g. M-2 … M-11, GET)', aka: AKA.level, ex: ['M-6', 'M-10', 'M-4'] },
      { name: 'Management Band', key: 'mgmt_band', type: 'enum', enum: 'mgmtBand', required: false, desc: 'SM / MM / JM / Blue Collar — distinct from Grade Band', aka: ['Band', 'Mgmt Band', 'Management Level', 'Employee Band'], ex: ['MM', 'Blue Collar', 'SM'] },
      { name: 'Domicile State', key: 'domicile_state', type: 'text', required: false, desc: 'State of domicile (local = the asset’s home state)', aka: ['Domicile', 'Home State', 'State of Domicile', 'Native State'], ex: ['Gujarat', 'Odisha', 'Maharashtra'] },
      { name: 'Hire Type', key: 'hire_type', type: 'enum', enum: 'hireType', required: false, desc: 'Lateral / Campus / GET / Rehire — the channel the employee was originally hired through', aka: ['Type of Hire', 'Hiring Type', 'Recruitment Type', 'Hire Category'], ex: ['Lateral', 'GET', 'Lateral'] },
      { name: 'Position ID', key: 'position_id', type: 'text', required: false, desc: 'Position the employee occupies (joins to positions.csv)', aka: ['Position Code', 'Position Number', 'Pos ID', 'Position No'], ex: ['POS-HZ-00412', 'POS-PD-01877', 'POS-VZ-00031'] }
    ]
  },

  exits: {
    label: 'Exits',
    source: 'HRMS',
    desc: 'One row per separation in the history window. Employee ID should exist in the employee master. Retirements are listed here but excluded from every attrition rate.',
    keyColumn: 'employee_id',
    columns: [
      { name: 'Employee ID', key: 'employee_id', type: 'id', required: true, desc: 'Employee who exited', aka: AKA.empId, akaExact: AKA.empIdReport, ex: ['AMNS-HZ-00135', 'AMNS-PD-00072', 'AMNS-KD-00311'] },
      { name: 'Exit Date', key: 'exit_date', type: 'date', required: true, desc: 'Last working day', aka: ['Last Working Day', 'LWD', 'Separation Date', 'Date of Exit', 'Relieving Date'], ex: ['18-05-2025', '02-01-2025', '30-11-2024'] },
      { name: 'Exit Type', key: 'exit_type', type: 'enum', enum: 'exitType', required: true, desc: 'Voluntary, Involuntary or Retirement (superannuation — counted separately, never in attrition rates)', aka: ['Separation Type', 'Exit Category', 'Type of Exit', 'Attrition Type'], ex: ['Voluntary', 'Involuntary', 'Retirement'] },
      { name: 'Regretted Flag', key: 'regretted_flag', type: 'flag', required: false, desc: 'Business regrets the exit (Y/N)', aka: ['Regretted', 'Regrettable Exit', 'Regret Flag'], ex: ['Y', 'N', 'N'] },
      { name: 'OK-to-Rehire Flag', key: 'rehire_flag', type: 'flag', required: false, desc: 'Tagged OK to rehire (Y/N)', aka: ['Rehire Eligible', 'Eligible for Rehire', 'Rehire Flag'], ex: ['Y', 'N', 'Y'] },
      { name: 'Exit Reason', key: 'exit_reason', type: 'text', required: false, desc: 'Primary stated reason (blank rows are surfaced in Data Quality)', aka: ['Reason for Leaving', 'Separation Reason', 'Leaving Reason', 'Resignation Reason'], ex: ['Better prospects', 'Performance', 'Superannuation'] },
      { name: 'Exit Reason Category', key: 'exit_reason_category', type: 'enum', enum: 'exitReasonCategory', required: false, desc: 'Standardised reason category for consistent “by reason” analysis', aka: ['Reason Category', 'Separation Reason Category', 'Exit Reason Group'], ex: ['Career growth', 'Performance', 'Retirement'] }
    ]
  },

  requisitions: {
    label: 'Requisitions',
    source: 'ATS',
    desc: 'One row per hiring requisition (open or closed) for the permanent roll. The lifecycle columns (status, offer and joining dates, source, recruiter) drive the TA Pipeline tab.',
    keyColumn: 'requisition_id',
    columns: [
      { name: 'Requisition ID', key: 'requisition_id', type: 'id', required: true, desc: 'Unique requisition identifier', aka: [...AKA.reqId, 'Position Code'], ex: ['REQ-2024-0113', 'REQ-2025-0027', 'REQ-2025-0031'] },
      { name: 'Asset', key: 'asset', type: 'enum', enum: 'asset', required: true, desc: 'Hiring asset', aka: [...AKA.asset, 'Hiring Location'], ex: ['Hazira', 'Vizag', 'Paradeep'] },
      { name: 'Grade', key: 'grade', type: 'text', required: false, desc: 'Grade of the position', aka: ['Position Grade', 'Grade Code'], ex: ['DGM', 'GM', 'S1'] },
      { name: 'Function', key: 'function', type: 'text', required: false, desc: 'Function / department (Function 1)', aka: AKA.func, ex: ['Operations', 'Project Engineering', 'HR'] },
      { name: 'Open Date', key: 'open_date', type: 'date', required: true, desc: 'Requisition approval / received date', aka: ['Req Received Date', 'Requisition Received Date', 'Req Date', 'Approval Date', 'Requisition Date'], ex: ['05-02-2025', '20-03-2025', '11-04-2025'] },
      { name: 'Type', key: 'req_type', type: 'enum', enum: 'reqType', required: false, desc: 'New position or replacement', aka: ['New/Replacement', 'Demand Type', 'Requisition Type', 'Req Type'], ex: ['Replacement', 'New', 'Replacement'] },
      { name: 'Posted Internally Flag', key: 'posted_flag', type: 'flag', required: false, desc: 'Posted on the internal job portal (Y/N)', aka: ['IJP Posted', 'Internal Posting', 'Posted on IJP'], ex: ['Y', 'Y', 'N'] },
      { name: 'Confidential Flag', key: 'confidential_flag', type: 'flag', required: false, desc: 'Confidential search — exempt from internal posting (Y/N)', aka: ['Confidential', 'Confidential Search'], ex: ['N', 'N', 'Y'] },
      { name: 'Closed Date', key: 'closed_date', type: 'date', required: false, desc: 'Blank if still open', aka: ['Closure Date', 'Req Closed Date', 'Date Closed'], ex: ['28-04-2025', '', ''] },
      { name: 'Closure Mode', key: 'closure_mode', type: 'enum', enum: 'closureMode', required: false, desc: 'How the position was filled', aka: ['Fill Mode', 'Closure Type', 'Filled Through'], ex: ['Internal', '', ''] },
      { name: 'Hired Employee ID', key: 'hired_employee_id', type: 'text', required: false, desc: 'Employee ID of the hire (if closed)', aka: ['Hired Emp ID', 'New Joiner ID', 'Selected Employee ID'], ex: ['AMNS-HZ-00892', '', ''] },
      { name: 'Company', key: 'company', type: 'text', required: false, desc: 'Hiring legal entity', aka: AKA.company, ex: ['Company A', 'Company A', 'Company A'] },
      { name: 'Function Plant', key: 'function_plant', type: 'text', required: false, desc: 'Plant / department unit (joins to org_units.csv)', aka: AKA.plant, ex: ['Steel Making', 'Expansion Projects', 'HR & Admin'] },
      { name: 'Business Segment', key: 'business_segment', type: 'enum', enum: 'segment', required: false, desc: 'Operations or Projects (blank = resolved from org_units.csv)', aka: AKA.segment, ex: ['Operations', 'Projects', 'Operations'] },
      { name: 'Level', key: 'level', type: 'text', required: false, desc: 'Grade-ladder level of the position', aka: [...AKA.level, 'Position Level'], ex: ['M-6', 'M-5', 'M-11'] },
      { name: 'Recruiter', key: 'recruiter', type: 'text', required: false, desc: 'Recruiter code (pseudonymous; shown masked by persona)', aka: ['TA Recruiter', 'Sourcer', 'Recruiter Code', 'TA Partner'], ex: ['REC-03', 'REC-09', 'REC-06'] },
      { name: 'Req Status', key: 'req_status', type: 'enum', enum: 'reqStatus', required: false, desc: 'Open / On Hold / Dropped / Offered / TBO (offer accepted, to be onboarded) / Closed', aka: ['Requisition Status', 'Current Stage', 'Stage', 'Status'], ex: ['Closed', 'Offered', 'Dropped'] },
      { name: 'Offer Date', key: 'offer_date', type: 'date', required: false, desc: 'Offer released to the selected candidate', aka: ['Offer Sent Date', 'Offer Released Date', 'Offer Release Date'], ex: ['20-03-2025', '10-06-2025', ''] },
      { name: 'Offer Accepted Date', key: 'offer_accepted_date', type: 'date', required: false, desc: 'Offer accepted by the candidate', aka: ['Offer Acceptance Date', 'Acceptance Date'], ex: ['24-03-2025', '', ''] },
      { name: 'Joining Date', key: 'joining_date', type: 'date', required: false, desc: 'Candidate’s actual joining date (TTF = Joining − Open)', aka: ['Date of Joining', 'DOJ', 'Candidate Joining Date', 'Actual Joining Date'], ex: ['25-04-2025', '', ''] },
      { name: 'Hire Source', key: 'hire_source', type: 'text', required: false, desc: 'Channel the hire came through', aka: ['Source', 'Sourcing Channel', 'Channel', 'Source of Hire'], ex: ['Internal Job Posting', 'Job Portal', ''] },
      { name: 'Drop Reason', key: 'drop_reason', type: 'text', required: false, desc: 'Why a requisition was dropped (Req Status = Dropped)', aka: ['Cancellation Reason', 'Req Drop Reason', 'Reason for Drop'], ex: ['', '', 'Position cancelled'] },
      { name: 'Ageing Reason', key: 'ageing_reason', type: 'text', required: false, desc: 'Why an open requisition is ageing', aka: ['Aging Reason', 'Delay Reason', 'Reason for Ageing'], ex: ['', 'Salary expectation gap', ''] }
    ]
  },

  internal_applications: {
    label: 'Internal applications',
    source: 'ATS',
    desc: 'One row per application on the internal job portal.',
    keyColumn: 'application_id',
    columns: [
      { name: 'Application ID', key: 'application_id', type: 'id', required: true, desc: 'Unique application identifier', aka: ['App ID', 'Application No', 'IJP Application ID'], ex: ['APP-05121', 'APP-05122', 'APP-05188'] },
      { name: 'Requisition ID', key: 'requisition_id', type: 'text', required: true, desc: 'Requisition applied to', aka: AKA.reqId, ex: ['REQ-2024-0113', 'REQ-2024-0113', 'REQ-2025-0027'] },
      { name: 'Applicant Employee ID', key: 'employee_id', type: 'text', required: true, desc: 'Internal applicant', aka: ['Employee ID', 'Applicant ID', 'Emp ID', 'Employee Code'], ex: ['AMNS-HZ-00245', 'AMNS-VZ-00082', 'AMNS-PD-00160'] },
      { name: 'Application Date', key: 'application_date', type: 'date', required: true, desc: 'Date applied', aka: ['Applied Date', 'Date Applied', 'Applied On'], ex: ['10-02-2025', '12-02-2025', '25-03-2025'] },
      { name: 'Status', key: 'status', type: 'enum', enum: 'appStatus', required: true, desc: 'Current stage', aka: ['Application Status', 'Current Stage', 'Stage'], ex: ['Interviewed', 'Rejected', 'Applied'] },
      { name: 'Last Action Date', key: 'last_action_date', type: 'date', required: false, desc: 'Date of last recruiter action (drives the >15-day ageing flag)', aka: ['Last Updated', 'Last Activity Date', 'Status Date'], ex: ['01-03-2025', '20-02-2025', '25-03-2025'] }
    ]
  },

  learning_events: {
    label: 'Learning events',
    source: 'LMS',
    desc: 'One row per employee per learning programme attended. Category, completion, feedback and cost columns are optional but unlock the L&D depth metrics.',
    columns: [
      { name: 'Employee ID', key: 'employee_id', type: 'id', required: true, desc: 'Participant', aka: [...AKA.empId, 'Participant ID', 'Learner ID'], ex: ['AMNS-HZ-00135', 'AMNS-KD-00088', 'AMNS-VZ-00018'] },
      { name: 'Programme', key: 'programme', type: 'text', required: true, desc: 'Programme name', aka: ['Program', 'Course', 'Course Name', 'Training Name', 'Programme Name'], ex: ['Safety Leadership', 'Data Analytics Basics', 'First-time Manager'] },
      { name: 'Start Date', key: 'start_date', type: 'date', required: true, desc: 'Programme start date', aka: ['Training Date', 'Session Date', 'Course Start Date'], ex: ['12-05-2025', '03-06-2025', '21-04-2025'] },
      { name: 'Person-Days', key: 'person_days', type: 'num', required: true, desc: 'Training person-days for this participant', aka: ['Training Days', 'Man-days', 'Duration (days)', 'Person Days'], ex: ['2', '0.5', '3'] },
      { name: 'Mode', key: 'mode', type: 'enum', enum: 'learnMode', required: false, desc: 'Classroom or E-learning', aka: ['Delivery Mode', 'Training Mode'], ex: ['Classroom', 'E-learning', 'Classroom'] },
      { name: 'Category', key: 'category', type: 'enum', enum: 'learnCategory', required: false, desc: 'Programme category (drives HSE/compliance coverage metrics)', aka: ['Training Category', 'Course Category', 'Programme Category'], ex: ['HSE', 'Technical/Functional', 'Behavioural'] },
      { name: 'Completion Status', key: 'completion', type: 'enum', enum: 'completionStatus', required: false, desc: 'Completed or In Progress', aka: ['Completion', 'Course Status', 'Training Status'], ex: ['Completed', 'Completed', 'In Progress'] },
      { name: 'Feedback Score', key: 'feedback', type: 'num', required: false, desc: 'Participant feedback, 1–5', aka: ['Feedback', 'Rating', 'Participant Feedback'], ex: ['4.5', '4', ''] },
      { name: 'Cost', key: 'cost', type: 'num', required: false, desc: 'Cost attributed to this participant (₹)', aka: ['Training Cost', 'Cost per Participant', 'Amount'], ex: ['8000', '1500', '12000'] }
    ]
  },

  idp_status: {
    label: 'IDP status',
    source: 'HRMS',
    desc: 'Individual Development Plan status for eligible employees (Top Talent + VP & above).',
    keyColumn: 'employee_id',
    columns: [
      { name: 'Employee ID', key: 'employee_id', type: 'id', required: true, desc: 'Eligible employee', aka: AKA.empId, ex: ['AMNS-HZ-00245', 'AMNS-PD-00003', 'AMNS-VZ-00002'] },
      { name: 'IDP on System Flag', key: 'idp_flag', type: 'flag', required: true, desc: 'IDP recorded on the system (Y/N)', aka: ['IDP Flag', 'IDP Available', 'IDP Created'], ex: ['Y', 'Y', 'N'] },
      { name: 'IDP Implementation %', key: 'idp_pct', type: 'pct', required: false, desc: '0–100 implementation of agreed actions', aka: ['IDP Progress', 'IDP Completion %', 'Implementation %'], ex: ['45', '20', ''] },
      { name: 'Last Updated', key: 'last_updated', type: 'date', required: false, desc: 'Last update to the IDP (stale dates are surfaced in Data Quality)', aka: ['Last Update Date', 'Updated On', 'IDP Last Updated'], ex: ['15-04-2025', '02-09-2024', ''] }
    ]
  },

  succession: {
    label: 'Succession',
    source: 'HRMS',
    desc: 'One row per successor mapping for GM-level and Critical Positions. Positions with no successor still get one row with successor fields blank.',
    columns: [
      { name: 'Position ID', key: 'position_id', type: 'id', required: true, desc: 'Position identifier', aka: ['Position Code', 'Pos ID', 'Role ID'], ex: ['POS-HZ-GM-012', 'POS-PD-CP-004', 'POS-VZ-GM-002'] },
      { name: 'Position Level', key: 'position_level', type: 'enum', enum: 'positionLevel', required: true, desc: 'GM-level or Critical Position', aka: ['Position Type', 'Role Level', 'Position Category'], ex: ['GM', 'CP', 'GM'] },
      { name: 'Incumbent Employee ID', key: 'incumbent_id', type: 'text', required: false, desc: 'Blank = vacant position', aka: ['Incumbent ID', 'Current Holder ID', 'Incumbent'], ex: ['AMNS-HZ-00021', 'AMNS-PD-00003', ''] },
      { name: 'Successor Employee ID', key: 'successor_id', type: 'text', required: false, desc: 'Blank = no identified successor', aka: ['Successor ID', 'Successor', 'Successor Emp ID'], ex: ['AMNS-HZ-00245', '', 'AMNS-VZ-00082'] },
      { name: 'Readiness', key: 'readiness', type: 'enum', enum: 'readiness', required: false, desc: 'Ready Now or 1-2 Years', aka: ['Readiness Level', 'Successor Readiness', 'Ready Status'], ex: ['Ready Now', '', '1-2 Years'] },
      { name: 'Successor has IDP Flag', key: 'succ_idp_flag', type: 'flag', required: false, desc: 'Successor has an IDP on system (Y/N)', aka: ['Successor IDP', 'Successor IDP Flag'], ex: ['Y', '', 'N'] }
    ]
  },

  lms_usage: {
    label: 'LMS usage',
    source: 'LMS',
    desc: 'One row per employee with a learning-platform licence.',
    keyColumn: 'employee_id',
    columns: [
      { name: 'Employee ID', key: 'employee_id', type: 'id', required: true, desc: 'Licensed employee', aka: AKA.empId, ex: ['AMNS-HZ-00135', 'AMNS-PD-00072', 'AMNS-KD-00311'] },
      { name: 'Licensed Flag', key: 'licensed_flag', type: 'flag', required: true, desc: 'Has an active licence (Y/N)', aka: ['Licence Active', 'Licensed', 'Has Licence'], ex: ['Y', 'Y', 'Y'] },
      { name: 'Last Login Date', key: 'last_login', type: 'date', required: false, desc: 'Blank = never logged in', aka: ['Last Login', 'Last Accessed', 'Last Activity'], ex: ['22-06-2025', '10-01-2025', ''] }
    ]
  },

  targets: {
    label: 'Targets',
    source: 'Finance/Budget master',
    desc: 'Optional targets per metric. Metric Key must match a registry key (see the data dictionary / Methodology tab). Metrics without a target row show "Target not set".',
    keyColumn: 'metric_key',
    columns: [
      { name: 'Metric Key', key: 'metric_key', type: 'id', required: true, desc: 'Registry key, e.g. attr_annualised', aka: ['Metric', 'KPI Key', 'Metric ID'], ex: ['attr_annualised', 'succession_coverage', 'learning_coverage_all'] },
      { name: 'Target Value', key: 'target_value', type: 'num', required: true, desc: 'Target in the metric’s own unit', aka: ['Target', 'Goal', 'Target Value'], ex: ['8', '80', '75'] },
      { name: 'Direction', key: 'direction', type: 'enum', enum: 'direction', required: true, desc: 'higher = higher is better; lower = lower is better', aka: ['Polarity', 'Better When', 'Target Direction'], ex: ['lower', 'higher', 'higher'] }
    ]
  },

  production_safety: {
    label: 'Production & safety',
    source: 'Finance/Budget master',
    desc: 'One row per asset per month (optionally split by Business Segment). Drives productivity, cost and safety metrics.',
    columns: [
      { name: 'Asset', key: 'asset', type: 'enum', enum: 'asset', required: true, desc: 'Asset', aka: AKA.asset, ex: ['Hazira', 'Hazira', 'Paradeep'] },
      { name: 'Month', key: 'month', type: 'month', required: true, desc: 'Month (MM-YYYY)', aka: AKA.month, ex: ['04-2025', '04-2025', '05-2025'] },
      { name: 'Crude Steel Tonnes', key: 'tonnes', type: 'num', required: false, desc: 'Crude steel production in tonnes', aka: ['Production (t)', 'Crude Steel', 'Tonnes', 'Production Tonnes'], ex: ['612000', '', '71500'] },
      { name: 'Man-hours Worked', key: 'man_hours', type: 'num', required: false, desc: 'Total man-hours incl. contract (LTIFR base)', aka: ['Man Hours', 'Manhours', 'Total Man-hours'], ex: ['2680000', '580000', '860000'] },
      { name: 'Lost-Time Injuries', key: 'lti', type: 'int', required: false, desc: 'Lost-time injuries in the month', aka: ['LTI', 'LTIs', 'Lost Time Injuries'], ex: ['0', '1', '0'] },
      { name: 'Man-days Lost to IR', key: 'ir_days', type: 'num', required: false, desc: 'Man-days lost to industrial-relations action', aka: ['IR Man-days', 'Mandays Lost', 'Man-days Lost (IR)'], ex: ['0', '0', '120'] },
      { name: 'Employee Cost', key: 'employee_cost', type: 'num', required: false, desc: 'Employee cost for the month (₹)', aka: ['Manpower Cost', 'Payroll Cost', 'Staff Cost'], ex: ['1260000000', '220000000', '310000000'] },
      { name: 'Revenue', key: 'revenue', type: 'num', required: false, desc: 'Revenue for the month (₹)', aka: ['Net Revenue', 'Sales Revenue', 'Turnover'], ex: ['38200000000', '', '5400000000'] },
      { name: 'Business Segment', key: 'business_segment', type: 'enum', enum: 'segment', required: false, desc: 'Operations or Projects; blank rows only count when the segment filter is All', aka: AKA.segment, ex: ['Operations', 'Projects', 'Operations'] }
    ]
  },

  contract_attendance: {
    label: 'Contract attendance',
    source: 'SCRUM',
    desc: 'One row per contractor per asset per month. Source system: SCRUM.',
    columns: [
      { name: 'Contractor', key: 'contractor', type: 'text', required: true, desc: 'Contractor name/code', aka: AKA.contractor, ex: ['CNT-Alpha', 'CNT-Baseline', 'CNT-Alpha'] },
      { name: 'Asset', key: 'asset', type: 'enum', enum: 'asset', required: true, desc: 'Asset', aka: AKA.asset, ex: ['Hazira', 'Hazira', 'Paradeep'] },
      { name: 'Month', key: 'month', type: 'month', required: true, desc: 'Month (MM-YYYY)', aka: AKA.month, ex: ['05-2025', '05-2025', '05-2025'] },
      { name: 'Man-days Deployed', key: 'mandays_deployed', type: 'num', required: true, desc: 'Scheduled contractor man-days', aka: ['Mandays Deployed', 'Scheduled Mandays', 'Approved Mandays'], ex: ['10400', '6200', '4100'] },
      { name: 'Man-days Present', key: 'mandays_present', type: 'num', required: true, desc: 'Actual man-days present', aka: ['Mandays Present', 'Actual Mandays', 'Present Mandays'], ex: ['9750', '5840', '3820'] },
      { name: 'Contract Headcount', key: 'contract_headcount', type: 'int', required: true, desc: 'Contract workers on roll in the month', aka: ['Contract HC', 'Contract Workers', 'Manpower Count'], ex: ['400', '238', '158'] },
      { name: 'Contract Labour Cost', key: 'contract_cost', type: 'num', required: false, desc: 'Invoiced contract-labour cost for the month (₹) — drives cost per manday', aka: ['CL Cost', 'Monthly Invoice', 'Invoice Amount', 'Contract Cost'], ex: ['8970000', '5670000', '3290000'] },
      { name: 'Business Segment', key: 'business_segment', type: 'enum', enum: 'segment', required: false, desc: 'Operations (O&M) or Projects (capex construction) deployment', aka: AKA.segment, ex: ['Operations', 'Projects', 'Operations'] }
    ]
  },

  contract_compliance: {
    label: 'Contract compliance',
    source: 'Aparajita',
    desc: 'One row per contractor per asset per month. Source system: Aparajita.',
    columns: [
      { name: 'Contractor', key: 'contractor', type: 'text', required: true, desc: 'Contractor name/code', aka: AKA.contractor, ex: ['CNT-Alpha', 'CNT-Baseline', 'CNT-Alpha'] },
      { name: 'Asset', key: 'asset', type: 'enum', enum: 'asset', required: true, desc: 'Asset', aka: AKA.asset, ex: ['Hazira', 'Hazira', 'Paradeep'] },
      { name: 'Month', key: 'month', type: 'month', required: true, desc: 'Month (MM-YYYY)', aka: AKA.month, ex: ['05-2025', '05-2025', '05-2025'] },
      { name: 'PF/ESI Remittance OK Flag', key: 'pf_esi_flag', type: 'flag', required: true, desc: 'Statutory remittances on time (Y/N)', aka: ['PF ESI Compliance', 'PF/ESIC Challan OK', 'PF & ESI'], ex: ['Y', 'Y', 'N'] },
      { name: 'Wage Payment On-Time Flag', key: 'wage_flag', type: 'flag', required: true, desc: 'Wages paid on time (Y/N)', aka: ['Wages On Time', 'Wage Payment', 'Wage Timeliness'], ex: ['Y', 'N', 'Y'] },
      { name: 'Labour Licence Valid Flag', key: 'licence_flag', type: 'flag', required: true, desc: 'Labour licence valid for the month (Y/N)', aka: ['Labour Licence', 'Licence Valid', 'CLRA Licence'], ex: ['Y', 'Y', 'Y'] },
      { name: 'Safety Induction Coverage %', key: 'induction_pct', type: 'pct', required: true, desc: '% of deployed workers with valid safety induction', aka: ['Induction Coverage', 'Safety Induction %', 'Induction %'], ex: ['96', '88', '92'] },
      { name: 'Business Segment', key: 'business_segment', type: 'enum', enum: 'segment', required: false, desc: 'Operations or Projects deployment of the contractor', aka: AKA.segment, ex: ['Operations', 'Projects', 'Operations'] }
    ]
  },

  pms_status: {
    label: 'Performance management status',
    source: 'HRMS',
    desc: 'One row per on-roll employee in the current performance cycle. Drives goal-setting, mid-year and annual review completion metrics — statuses and flags only, never ratings.',
    keyColumn: 'employee_id',
    columns: [
      { name: 'Employee ID', key: 'employee_id', type: 'id', required: true, desc: 'Employee in the cycle', aka: AKA.empId, ex: ['AMNS-HZ-00135', 'AMNS-PD-00072', 'AMNS-VZ-00018'] },
      { name: 'Goal Setting Complete Flag', key: 'goal_flag', type: 'flag', required: true, desc: 'Goals agreed and locked on the system (Y/N)', aka: ['Goal Setting Done', 'Goals Locked', 'Goal Setting Flag'], ex: ['Y', 'Y', 'N'] },
      { name: 'Mid-Year Review Complete Flag', key: 'midyear_flag', type: 'flag', required: false, desc: 'Mid-year review completed (Y/N)', aka: ['Mid-Year Done', 'MYR Complete', 'Mid Year Review Flag'], ex: ['Y', 'N', 'N'] },
      { name: 'Annual Review Complete Flag', key: 'annual_flag', type: 'flag', required: false, desc: 'Year-end (annual) review completed (Y/N); blank = not in scope, e.g. joined after the cycle', aka: ['Annual Appraisal Done', 'Year-End Review Complete', 'Annual Review Flag'], ex: ['Y', 'Y', 'N'] },
      { name: 'Goal Setting Status', key: 'goal_status', type: 'enum', enum: 'goalStatus', required: false, desc: 'Not started / Draft / Submitted / Approved', aka: ['Goal Status', 'Goal Sheet Status'], ex: ['Approved', 'Approved', 'Draft'] },
      { name: 'Mid-Year Status', key: 'midyear_status', type: 'enum', enum: 'midYearStatus', required: false, desc: 'Not started / Self-review done / Manager review done / Completed', aka: ['MYR Status', 'Mid Year Review Status'], ex: ['Completed', 'Self-review done', 'Not started'] },
      { name: 'Annual Review Status', key: 'annual_status', type: 'enum', enum: 'annualStatus', required: false, desc: 'Not started / Self-appraisal done / Manager review done / Completed', aka: ['Appraisal Status', 'Year-End Status', 'Annual Appraisal Status'], ex: ['Completed', 'Completed', 'Manager review done'] }
    ]
  },

  recognition: {
    label: 'Recognition awards',
    source: 'HRMS',
    desc: 'One row per award given in the history window. Drives recognition coverage (unique employees recognised).',
    columns: [
      { name: 'Employee ID', key: 'employee_id', type: 'id', required: true, desc: 'Awarded employee', aka: AKA.empId, ex: ['AMNS-HZ-00135', 'AMNS-KD-00088', 'AMNS-HZ-00135'] },
      { name: 'Award Date', key: 'award_date', type: 'date', required: true, desc: 'Date of the award', aka: ['Recognition Date', 'Date of Award'], ex: ['14-05-2025', '02-06-2025', '20-06-2025'] },
      { name: 'Award Name', key: 'award_name', type: 'text', required: false, desc: 'Award / recognition programme name', aka: ['Award', 'Recognition Type', 'Award Category'], ex: ['Spot Award', 'Safety Champion', 'Quarterly Excellence'] }
    ]
  },

  wellbeing: {
    label: 'Wellbeing (aggregates)',
    source: 'HRMS',
    desc: 'One row per asset per month (optionally split by Business Segment), AGGREGATE COUNTS ONLY — no individual health or counselling data ever enters this dashboard.',
    columns: [
      { name: 'Asset', key: 'asset', type: 'enum', enum: 'asset', required: true, desc: 'Asset', aka: AKA.asset, ex: ['Hazira', 'Paradeep', 'Vizag'] },
      { name: 'Month', key: 'month', type: 'month', required: true, desc: 'Month (MM-YYYY)', aka: AKA.month, ex: ['05-2025', '05-2025', '06-2025'] },
      { name: 'Counselling Sessions', key: 'sessions', type: 'int', required: true, desc: 'Counselling sessions held (aggregate count)', aka: ['Sessions', 'EAP Sessions'], ex: ['42', '11', '9'] },
      { name: 'Unique Employees Counselled', key: 'unique_counselled', type: 'int', required: false, desc: 'Distinct employees who used counselling (aggregate count)', aka: ['Unique Counselled', 'Employees Counselled'], ex: ['25', '8', '6'] },
      { name: 'Distress Cases', key: 'distress', type: 'int', required: false, desc: 'Severe/distress cases escalated (aggregate count)', aka: ['Escalated Cases', 'Severe Cases'], ex: ['0', '1', '0'] },
      { name: 'Wellness Programme Attendees', key: 'wellness_attendees', type: 'int', required: false, desc: 'Attendees at wellness sessions/webinars (aggregate count)', aka: ['Wellness Attendees', 'Webinar Attendees'], ex: ['180', '45', '60'] },
      { name: 'Business Segment', key: 'business_segment', type: 'enum', enum: 'segment', required: false, desc: 'Operations or Projects; blank rows only count when the segment filter is All', aka: AKA.segment, ex: ['Operations', 'Operations', 'Projects'] }
    ]
  },

  org_units: {
    label: 'Org units',
    source: 'HRMS',
    desc: 'One row per Function Plant: resolves Function, Business Segment, Company and MC member for any row that carries only Function Plant. MC Member holds a role label or code — never a person’s name.',
    keyColumn: 'function_plant',
    columns: [
      { name: 'Function Plant', key: 'function_plant', type: 'id', required: true, desc: 'Plant / department unit (key)', aka: AKA.plant, ex: ['Steel Making', 'Expansion Projects', 'Finance Shared Services'] },
      { name: 'Function', key: 'function', type: 'text', required: true, desc: 'Parent function (Function 1)', aka: AKA.func, ex: ['Operations', 'Project Engineering', 'Finance'] },
      { name: 'Business Segment', key: 'business_segment', type: 'enum', enum: 'segment', required: true, desc: 'Operations or Projects', aka: AKA.segment, ex: ['Operations', 'Projects', 'Operations'] },
      { name: 'Company', key: 'company', type: 'text', required: false, desc: 'Legal entity when the unit belongs to one company (blank = per employee)', aka: AKA.company, ex: ['', '', 'Company C'] },
      { name: 'Asset', key: 'asset', type: 'enum', enum: 'asset', required: false, desc: 'Asset when the unit exists at one site only (blank = all assets)', aka: AKA.asset, ex: ['', '', 'Hazira'] },
      { name: 'MC Member', key: 'mc_member', type: 'text', required: false, desc: 'Management-committee owner — role label or code only', aka: ['MC', 'Function Owner', 'MC Owner', 'Management Committee Member'], ex: ['MC-01', 'MC-03', 'MC-06'] }
    ]
  },

  hc_budget: {
    label: 'Headcount budget',
    source: 'Finance/Budget master',
    desc: 'Approved (budgeted) permanent headcount per month per Asset → Function → Function Plant (optionally by Level). Drives the Budget vs Actual matrix.',
    columns: [
      { name: 'Month', key: 'month', type: 'month', required: true, desc: 'Month (MM-YYYY)', aka: [...AKA.month, 'Budget Month'], ex: ['04-2025', '04-2025', '05-2025'] },
      { name: 'Asset', key: 'asset', type: 'enum', enum: 'asset', required: true, desc: 'Asset', aka: AKA.asset, ex: ['Hazira', 'Hazira', 'Paradeep'] },
      { name: 'Business Segment', key: 'business_segment', type: 'enum', enum: 'segment', required: false, desc: 'Operations or Projects (blank = resolved from org_units.csv)', aka: AKA.segment, ex: ['Operations', 'Projects', 'Operations'] },
      { name: 'Company', key: 'company', type: 'text', required: false, desc: 'Legal entity', aka: AKA.company, ex: ['Company A', 'Company A', 'Company A'] },
      { name: 'Function', key: 'function', type: 'text', required: true, desc: 'Function (Function 1)', aka: AKA.func, ex: ['Operations', 'Project Engineering', 'Maintenance'] },
      { name: 'Function Plant', key: 'function_plant', type: 'text', required: true, desc: 'Plant / department unit', aka: AKA.plant, ex: ['Steel Making', 'Expansion Projects', 'Mechanical Maintenance'] },
      { name: 'Level', key: 'level', type: 'text', required: false, desc: 'Optional level split (blank = the whole unit)', aka: AKA.level, ex: ['', 'M-6', ''] },
      { name: 'Budget Headcount', key: 'budget_hc', type: 'int', required: true, desc: 'Approved / sanctioned headcount', aka: ['Approved Headcount', 'Sanctioned Strength', 'Budgeted HC', 'Approved Positions', 'Budget HC'], ex: ['412', '58', '236'] }
    ]
  },

  positions: {
    label: 'Positions',
    source: 'HRMS',
    desc: 'One row per position (filled, vacant, frozen or on hold). Drives vacancy, vacancy ageing and budget-vs-filled views.',
    keyColumn: 'position_id',
    columns: [
      { name: 'Position ID', key: 'position_id', type: 'id', required: true, desc: 'Unique position identifier', aka: ['Position Code', 'Position Number', 'Pos ID', 'Position No'], ex: ['POS-HZ-00412', 'POS-PD-01877', 'POS-VZ-00031'] },
      { name: 'Position Title', key: 'position_title', type: 'text', required: false, desc: 'Position / role title', aka: ['Position Name', 'Designation', 'Job Title', 'Role'], ex: ['Deputy General Manager – Steel Making', 'Technician – Project Commissioning', 'Vice President – Finance & Accounts'] },
      { name: 'Asset', key: 'asset', type: 'enum', enum: 'asset', required: true, desc: 'Asset', aka: AKA.asset, ex: ['Hazira', 'Paradeep', 'Vizag'] },
      { name: 'Company', key: 'company', type: 'text', required: false, desc: 'Legal entity', aka: AKA.company, ex: ['Company A', 'Company A', 'Company A'] },
      { name: 'Business Segment', key: 'business_segment', type: 'enum', enum: 'segment', required: false, desc: 'Operations or Projects (blank = resolved from org_units.csv)', aka: AKA.segment, ex: ['Operations', 'Projects', 'Operations'] },
      { name: 'Function', key: 'function', type: 'text', required: false, desc: 'Function (Function 1)', aka: AKA.func, ex: ['Operations', 'Maintenance', 'Finance'] },
      { name: 'Function Plant', key: 'function_plant', type: 'text', required: false, desc: 'Plant / department unit', aka: AKA.plant, ex: ['Steel Making', 'Project Commissioning', 'Finance & Accounts'] },
      { name: 'Level', key: 'level', type: 'text', required: false, desc: 'Grade-ladder level of the position', aka: AKA.level, ex: ['M-6', 'M-10', 'M-4'] },
      { name: 'Position Status', key: 'position_status', type: 'enum', enum: 'positionStatus', required: true, desc: 'Filled / Vacant / Frozen / On Hold', aka: ['Status', 'Position State', 'Vacancy Status'], ex: ['Filled', 'Vacant', 'Frozen'] },
      { name: 'Budgeted Flag', key: 'budgeted_flag', type: 'flag', required: true, desc: 'Position is within the approved budget (Y/N)', aka: ['Budgeted', 'Budgeted/Non-Budgeted', 'Budget Flag', 'Sanctioned'], ex: ['Y', 'Y', 'Y'] },
      { name: 'Critical Position Flag', key: 'cp_flag', type: 'flag', required: false, desc: 'Critical Position (Y/N)', aka: ['CP Flag', 'Critical Position', 'Critical Role'], ex: ['N', 'N', 'Y'] },
      { name: 'Incumbent Employee ID', key: 'incumbent_id', type: 'text', required: false, desc: 'Employee occupying the position (blank when not filled)', aka: ['Incumbent ID', 'Holder Employee ID', 'Occupied By', 'Employee ID'], ex: ['AMNS-HZ-00135', '', ''] },
      { name: 'Vacant Since', key: 'vacant_since', type: 'date', required: false, desc: 'Date the position became vacant (drives vacancy ageing)', aka: ['Vacancy Date', 'Vacant From', 'Date Vacated'], ex: ['', '14-03-2025', '02-09-2024'] },
      { name: 'Requisition ID', key: 'requisition_id', type: 'text', required: false, desc: 'Open requisition raised against the position', aka: [...AKA.reqId, 'Open Requisition'], ex: ['', 'REQ-2025-0044', ''] }
    ]
  },

  employee_movements: {
    label: 'Employee movements',
    source: 'HRMS',
    desc: 'One row per movement event (promotion, transfer, re-designation, segment change). “To” values are the state after the movement; the latest movement matches the employee master.',
    columns: [
      { name: 'Employee ID', key: 'employee_id', type: 'id', required: true, desc: 'Employee who moved', aka: AKA.empId, ex: ['AMNS-HZ-00135', 'AMNS-PD-00072', 'AMNS-VZ-00018'] },
      { name: 'Effective Date', key: 'effective_date', type: 'date', required: true, desc: 'Date the movement took effect', aka: ['Movement Date', 'Effective From', 'Action Date', 'Date of Movement'], ex: ['01-04-2021', '15-09-2024', '01-10-2019'] },
      { name: 'Movement Type', key: 'movement_type', type: 'enum', enum: 'movementType', required: true, desc: 'Promotion / Transfer – Location / Transfer – Function / Transfer – Company / Re-designation / Segment Change', aka: ['Action Type', 'Movement', 'Change Type', 'Event Type'], ex: ['Promotion', 'Transfer – Location', 'Transfer – Company'] },
      { name: 'From Asset', key: 'from_asset', type: 'enum', enum: 'asset', required: false, desc: 'Asset before the movement', aka: ['Previous Asset', 'Old Location', 'From Location'], ex: ['Hazira', 'Hazira', 'Vizag'] },
      { name: 'To Asset', key: 'to_asset', type: 'enum', enum: 'asset', required: false, desc: 'Asset after the movement', aka: ['New Asset', 'New Location', 'To Location'], ex: ['Hazira', 'Paradeep', 'Vizag'] },
      { name: 'From Function', key: 'from_function', type: 'text', required: false, desc: 'Function before the movement', aka: ['Previous Function', 'Old Function', 'From Department'], ex: ['Operations', 'Maintenance', 'Finance'] },
      { name: 'To Function', key: 'to_function', type: 'text', required: false, desc: 'Function after the movement', aka: ['New Function', 'To Department'], ex: ['Operations', 'Maintenance', 'Finance'] },
      { name: 'From Level', key: 'from_level', type: 'text', required: false, desc: 'Level before the movement', aka: ['Previous Level', 'Old Level', 'From Grade'], ex: ['M-7', 'M-10', 'M-4'] },
      { name: 'To Level', key: 'to_level', type: 'text', required: false, desc: 'Level after the movement', aka: ['New Level', 'To Grade'], ex: ['M-6', 'M-10', 'M-4'] },
      { name: 'From Company', key: 'from_company', type: 'text', required: false, desc: 'Legal entity before the movement', aka: ['Previous Company', 'Old Entity', 'From Entity'], ex: ['Company A', 'Company A', 'Company A'] },
      { name: 'To Company', key: 'to_company', type: 'text', required: false, desc: 'Legal entity after the movement', aka: ['New Company', 'New Entity', 'To Entity'], ex: ['Company A', 'Company A', 'Company C'] },
      { name: 'From Segment', key: 'from_segment', type: 'enum', enum: 'segment', required: false, desc: 'Business segment before the movement', aka: ['Previous Segment', 'Old Segment'], ex: ['Operations', 'Projects', 'Operations'] },
      { name: 'To Segment', key: 'to_segment', type: 'enum', enum: 'segment', required: false, desc: 'Business segment after the movement', aka: ['New Segment'], ex: ['Operations', 'Projects', 'Operations'] }
    ]
  },

  candidate_pipeline: {
    label: 'Candidate pipeline',
    source: 'ATS',
    desc: 'One row per candidate per requisition with dated stage progression. Candidate IDs must be pseudonymous — no names, phone numbers or e-mails.',
    keyColumn: 'candidate_id',
    columns: [
      { name: 'Candidate ID', key: 'candidate_id', type: 'id', required: true, desc: 'Pseudonymous candidate identifier', aka: ['Candidate Code', 'Applicant ID', 'Candidate No'], ex: ['CND-004512', 'CND-004513', 'CND-003977'] },
      { name: 'Requisition ID', key: 'requisition_id', type: 'text', required: true, desc: 'Requisition applied to', aka: [...AKA.reqId, 'Position Code'], ex: ['REQ-2025-0027', 'REQ-2025-0027', 'REQ-2024-0113'] },
      { name: 'Source', key: 'source', type: 'text', required: true, desc: 'Sourcing channel, e.g. Employee Referral / Job Portal / Consultant / Campus / Careers Site / Internal Job Posting', aka: ['Sourcing Channel', 'Channel', 'Candidate Source', 'Source of Hire'], ex: ['Employee Referral', 'Job Portal', 'Internal Job Posting'] },
      { name: 'Gender', key: 'gender', type: 'enum', enum: 'gender', required: false, desc: 'Gender (drives representation across the funnel)', aka: ['Sex'], ex: ['Male', 'Female', 'Male'] },
      { name: 'Applied Date', key: 'applied_date', type: 'date', required: true, desc: 'Application / sourcing date', aka: ['Application Date', 'Date Applied', 'Sourced Date', 'CV Received Date'], ex: ['22-03-2025', '24-03-2025', '10-02-2025'] },
      { name: 'Screened Date', key: 'screened_date', type: 'date', required: false, desc: 'Shortlisted after screening', aka: ['Shortlist Date', 'Screening Date', 'CV Shortlisted Date'], ex: ['26-03-2025', '29-03-2025', '14-02-2025'] },
      { name: 'Interview Date', key: 'interview_date', type: 'date', required: false, desc: 'Interview held', aka: ['Selection Date', 'Final Interview Date'], ex: ['08-04-2025', '11-04-2025', '03-03-2025'] },
      { name: 'Offer Date', key: 'offer_date', type: 'date', required: false, desc: 'Offer released', aka: ['Offer Sent Date', 'Offer Released Date'], ex: ['10-06-2025', '', '20-03-2025'] },
      { name: 'Offer Accepted Date', key: 'offer_accepted_date', type: 'date', required: false, desc: 'Offer accepted', aka: ['Offer Acceptance Date', 'Acceptance Date'], ex: ['', '', '24-03-2025'] },
      { name: 'Joined Date', key: 'joined_date', type: 'date', required: false, desc: 'Joined the company', aka: ['Joining Date', 'Date of Joining', 'DOJ'], ex: ['', '', '25-04-2025'] },
      { name: 'Current Stage', key: 'current_stage', type: 'enum', enum: 'candidateStage', required: true, desc: 'Applied / Screened / Interview / Offered / Offer Accepted / Joined / Dropped', aka: ['Stage', 'Status', 'Candidate Status', 'Current Status'], ex: ['Offered', 'Dropped', 'Joined'] },
      { name: 'Drop Reason', key: 'drop_reason', type: 'text', required: false, desc: 'Why the candidate left the funnel (Current Stage = Dropped)', aka: ['Reason for Drop', 'Rejection Reason', 'Decline Reason'], ex: ['', 'Rejected in interview', ''] },
      { name: 'Recruiter', key: 'recruiter', type: 'text', required: false, desc: 'Recruiter code (pseudonymous)', aka: ['TA Recruiter', 'Sourcer', 'Recruiter Code'], ex: ['REC-09', 'REC-09', 'REC-03'] }
    ]
  },

  absence_monthly: {
    label: 'Absence (monthly)',
    source: 'Attendance',
    desc: 'One row per employee per month: day counts only — no leave reasons, medical or sick-note data.',
    columns: [
      { name: 'Employee ID', key: 'employee_id', type: 'id', required: true, desc: 'Employee', aka: AKA.empId, ex: ['AMNS-HZ-00135', 'AMNS-PD-00072', 'AMNS-VZ-00018'] },
      { name: 'Month', key: 'month', type: 'month', required: true, desc: 'Month (MM-YYYY)', aka: [...AKA.month, 'Attendance Month'], ex: ['05-2025', '05-2025', '05-2025'] },
      { name: 'Scheduled Days', key: 'scheduled_days', type: 'num', required: true, desc: 'Rostered working days in the month', aka: ['Working Days', 'Rostered Days', 'Planned Working Days'], ex: ['26', '26', '25'] },
      { name: 'Days Present', key: 'days_present', type: 'num', required: true, desc: 'Days actually present', aka: ['Present Days', 'Days Worked', 'Attendance Days'], ex: ['24', '21', '25'] },
      { name: 'Planned Leave Days', key: 'planned_leave_days', type: 'num', required: false, desc: 'Pre-approved leave days', aka: ['Planned Leave', 'Approved Leave Days', 'Leave Days (Planned)'], ex: ['2', '3', '0'] },
      { name: 'Unplanned Absence Days', key: 'unplanned_days', type: 'num', required: true, desc: 'Unplanned / unauthorised absence days (drives absenteeism %)', aka: ['Unplanned Absence', 'LWP Days', 'Unauthorised Absence Days', 'Absent Days'], ex: ['0', '2', '0'] },
      { name: 'Absence Spells', key: 'absence_spells', type: 'int', required: false, desc: 'Separate unplanned-absence occurrences in the month', aka: ['Spells', 'Absence Occurrences', 'No. of Absence Spells'], ex: ['0', '2', '0'] }
    ]
  },

  statutory_compliance: {
    label: 'Statutory compliance',
    source: 'Aparajita',
    desc: 'One row per asset per month per statutory item (remittances, returns, licence renewals) with due and completion dates.',
    columns: [
      { name: 'Asset', key: 'asset', type: 'enum', enum: 'asset', required: true, desc: 'Asset', aka: AKA.asset, ex: ['Hazira', 'Paradeep', 'Hazira'] },
      { name: 'Business Segment', key: 'business_segment', type: 'enum', enum: 'segment', required: false, desc: 'Operations or Projects (blank rows only count when the segment filter is All)', aka: AKA.segment, ex: ['Operations', 'Operations', 'Projects'] },
      { name: 'Month', key: 'month', type: 'month', required: true, desc: 'Compliance month (MM-YYYY)', aka: [...AKA.month, 'Compliance Month'], ex: ['05-2025', '05-2025', '04-2025'] },
      { name: 'Compliance Item', key: 'compliance_item', type: 'text', required: true, desc: 'Statutory item / document', aka: ['Compliance', 'Statutory Item', 'Document', 'Compliance Requirement'], ex: ['PF remittance', 'Professional tax', 'BOCW welfare cess'] },
      { name: 'Due Date', key: 'due_date', type: 'date', required: true, desc: 'Statutory due date', aka: ['Due On', 'Statutory Due Date', 'Deadline'], ex: ['15-06-2025', '30-06-2025', '15-05-2025'] },
      { name: 'Completed Date', key: 'completed_date', type: 'date', required: false, desc: 'Date completed / filed (blank = not yet)', aka: ['Completion Date', 'Filed On', 'Date Completed', 'Submitted On'], ex: ['12-06-2025', '', '21-05-2025'] },
      { name: 'Status', key: 'status', type: 'enum', enum: 'complianceStatus', required: true, desc: 'On time / Late / Pending / Not applicable', aka: ['Compliance Status', 'Completion Status', 'State'], ex: ['On time', 'Pending', 'Late'] },
      { name: 'Critical Item Flag', key: 'critical_flag', type: 'flag', required: false, desc: 'Y = a critical licence / consent (blank = judged from the item name against the configured critical items)', aka: ['Critical Item', 'Critical Flag', 'Criticality Flag', 'Is Critical'], ex: ['N', 'N', 'N'] }
    ]
  }
};

const SCHEMA_IDS = Object.keys(SCHEMAS);
