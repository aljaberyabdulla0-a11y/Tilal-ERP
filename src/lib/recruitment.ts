// التوظيف والتهيئة والتجربة (sql/150–151) — أنواع وثوابت بلا استيراد خادم،
// فتُستورد من مكوّنات العميل والخادم معاً.

export type JobRequisition = {
  id: string;
  req_no: string;
  department_id: string;
  position_id: string | null;
  title: string;
  headcount: number;
  employment_type: string;
  reason: string;
  justification: string | null;
  salary_min: number | null;
  salary_max: number | null;
  needed_by: string | null;
  status: string;
  requested_by: string | null;
  requested_by_name: string | null;
  hr_decided_by_name: string | null;
  hr_note: string | null;
  mgmt_decided_by_name: string | null;
  mgmt_note: string | null;
  created_at: string;
};

export type JobOpening = {
  id: string;
  opening_no: string;
  requisition_id: string | null;
  title: string;
  department_id: string;
  position_id: string | null;
  employment_type: string;
  headcount: number;
  hiring_manager_id: string | null;
  description: string | null;
  requirements: string | null;
  status: string;
  opened_at: string;
  closes_at: string | null;
};

// أعمدة المرشح المقروءة للجميع — الراتب المتوقّع خارجها (candidate_expected_salary)
export const CANDIDATE_COLUMNS =
  "id, full_name, phone, email, source, current_title, cv_path, cv_file_name, notes, created_at";

export type Candidate = {
  id: string;
  full_name: string;
  phone: string | null;
  email: string | null;
  source: string;
  current_title: string | null;
  cv_path: string | null;
  cv_file_name: string | null;
  notes: string | null;
  created_at: string;
};

export type JobApplication = {
  id: string;
  opening_id: string;
  candidate_id: string;
  stage: string;
  stage_changed_at: string;
  rejection_reason: string | null;
  employee_id: string | null;
  created_at: string;
};

export type JobInterview = {
  id: string;
  application_id: string;
  round: number;
  scheduled_at: string;
  mode: string;
  location: string | null;
  interviewer_id: string;
  status: string;
  score: number | null;
  recommendation: string | null;
  feedback: string | null;
};

export type JobOffer = {
  id: string;
  offer_no: string;
  application_id: string;
  salary: number;
  start_date: string;
  probation_months: number;
  status: string;
  created_by: string | null;
  created_by_name: string | null;
  approved_by_name: string | null;
  decision_note: string | null;
  notes: string | null;
};

export type MyInterview = {
  id: string;
  scheduled_at: string;
  mode: string;
  location: string | null;
  status: string;
  round: number;
  score: number | null;
  recommendation: string | null;
  feedback: string | null;
  candidate_id: string;
  candidate_name: string;
  current_title: string | null;
  has_cv: boolean;
  opening_title: string;
  department_name: string | null;
};

export type OnboardingTask = {
  id: string;
  employee_id: string;
  template_code: string | null;
  title: string;
  owner_role: string;
  assignee_id: string | null;
  due_date: string | null;
  status: string;
  auto_rule: string | null;
  completed_at: string | null;
  completed_by_name: string | null;
  note: string | null;
};

export type ProbationRow = {
  employee_id: string;
  employee_code: string;
  full_name: string;
  position_title: string | null;
  department_name: string | null;
  manager_name: string | null;
  probation_start: string | null;
  probation_end: string;
  days_left: number;
  manager_review: boolean;
  hr_review: boolean;
  manager_score: number | null;
  hr_score: number | null;
  manager_recommendation: string | null;
  hr_recommendation: string | null;
  last_decision: string | null;
  can_decide: boolean;
};

export const PIPELINE_STAGES = ["جديد", "فرز", "مقابلة", "تقييم", "عرض"] as const;
export const FINAL_STAGES = ["تم التعيين", "مرفوض", "انسحب"] as const;

export const CANDIDATE_SOURCES = ["إحالة", "موقع الشركة", "لينكدإن", "وسائل التواصل", "وكالة توظيف", "أخرى"];

export const REQUISITION_STYLE: Record<string, string> = {
  "بانتظار HR": "bg-amber-100 text-amber-700",
  "بانتظار الإدارة": "bg-orange-100 text-orange-700",
  "معتمد": "bg-green-100 text-green-700",
  "مرفوض": "bg-red-100 text-red-700",
  "ملغى": "bg-gray-200 text-gray-600",
  "مغلق": "bg-gray-200 text-gray-600",
};

export const OFFER_STYLE: Record<string, string> = {
  "بانتظار الاعتماد": "bg-amber-100 text-amber-700",
  "معتمد": "bg-blue-100 text-blue-700",
  "مقبول": "bg-green-100 text-green-700",
  "رُفض داخلياً": "bg-red-100 text-red-700",
  "رفضه المرشح": "bg-red-100 text-red-700",
  "مسحوب": "bg-gray-200 text-gray-600",
};
