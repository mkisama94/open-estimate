import type { InputCommitment } from "../core/certificate-contract.js";
/** Never generate receipts from model arguments, confirmed flags or natural-language text. */
export interface ApprovalAdapter {
  readonly mode:"production"|"test";
  verifyTransfer(id:string,binding:{principal_id:string;operation:"prepare_certificate_preview";input_commitment:InputCommitment;metadata_hash:string;policy_version:string;now:number}):Promise<boolean>;
  verifyPublication(id:string,binding:{principal_id:string;operation:"issue_and_publish";approved_draft_hash:string;policy_version:string;now:number}):Promise<{one_time_id:string;expires_at:number;trusted_channel:string}|null>;
  verifyWithdrawal(id:string,binding:{principal_id:string;operation:"withdraw_publication";share_id:string;signed_object_hash:string;status_generation:string;now:number}):Promise<boolean>;
}
