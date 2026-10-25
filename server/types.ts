export type ActorType = 'company' | 'candidate' | null;
export interface Session { id_hash: string; actor_type: ActorType; actor_id: string | null; organization_id: string | null; csrf_token: string; expires_at: Date }
export interface Membership { role: 'admin'|'recruiter'|'reviewer'; name: string }
export interface RequirementInput { label: string; weight: number; required: boolean }
export interface PositionInput { title: string; description: string; requirements: RequirementInput[] }
