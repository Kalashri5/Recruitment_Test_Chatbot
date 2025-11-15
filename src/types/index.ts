export interface Job {
  id: string;
  job_id: string;
  title: string;
  department: string | null;  // ✅ Added
  client_owner: string | null;
  status: string;
  location: string[];
  job_type: string;
  skills: string[];
  budget: string;
  budget_type: string;
  applications: number;
  posted_date: string;
  due_date: string;
  hiring_mode: string | null;
  submission_type: string | null;
  experience: any;
  description: string | null;
  description_bullets: string[];
  client_details: any;
  organization_id: string | null;
  created_at: string;
  updated_at: string;
  job_type_category: string | null;
  client_project_id: string | null;
  service_type: string | null;
  notice_period: string | null;
  number_of_candidates: number | null;
  created_by: string | null;
  updated_by: string | null;
  assigned_to: any;
  currency_type: string | null;
}

export interface Candidate {
  id: string;
  job_id: string;
  name: string;
  experience: string | null;
  match_score: number | null;
  applied_date: string;
  skills: string[];
  email: string | null;
  phone: string | null;
  resume_url: string | null;
  created_at: string;
  updated_at: string;
  metadata: any;
  skill_ratings: any;
  location: string | null;
  linkedin: string | null;
  github: string | null;
  availability: string | null;
  cover_letter: string | null;
  education: any;
  career_experience: any;
  applied_from: string | null;
  current_salary: string | null;
  expected_salary: string | null;
  organization_id: string | null;
  updated_by: string | null;
  preferred_location: string | null;
  notice_period: string | null;
  resume_filename: string | null;
  resume_size: number | null;
  resume_upload_date: string | null;
  main_status_id: string | null;
  sub_status_id: string | null;
  status: string;
  created_by: string | null;
  candidate_id: string | null;
  report_url: string | null;
  overall_score: number | null;
  skills_score: number | null;
  skills_summary: string | null;
  skills_enhancement_tips: string | null;
  work_experience_score: number | null;
  work_experience_summary: string | null;
  work_experience_enhancement_tips: string | null;
  projects_score: number | null;
  projects_summary: string | null;
  projects_enhancement_tips: string | null;
  education_score: number | null;
  education_summary: string | null;
  education_enhancement_tips: string | null;
  overall_summary: string | null;
  has_validated_resume: boolean | null;
  interview_date: string | null;
  interview_time: string | null;
  interview_location: string | null;
  interview_type: string | null;
  interviewer_name: string | null;
  round: string | null;
  reject_reason: string | null;
  reject_type: string | null;
  ctc: string | null;
  joining_date: string | null;
  interview_feedback: string | null;
  interview_result: string | null;
  accrual_ctc: string | null;
  budget_type: string | null;
  submission_date: string | null;
  consent_status: string | null;
  resume_text: string | null;
  projects: any;
  talent_id: string | null;
  schedule_date_time: string | null;
  rejection_reason: string | null;
  reason: string | null;
  action_date: string | null;
  offer_letter_url: string | null;
  joining_letter_url: string | null;
}

export interface Message {
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}

export interface ChatStats {
  totalCandidates: number;
  screening: number;
  interviewed: number;
  selected: number;
  rejected: number;
  averageScore: string;
}
