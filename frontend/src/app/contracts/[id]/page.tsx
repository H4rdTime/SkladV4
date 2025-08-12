// frontend/src/app/contracts/[id]/page.tsx
'use client';
import ContractForm from '@/components/ContractForm';
import { useParams } from 'next/navigation';

export default function EditContractPage() {
  const params = useParams();
  const id = Array.isArray(params.id) ? params.id[0] : params.id;
  
  return <ContractForm contractId={id} />;
}