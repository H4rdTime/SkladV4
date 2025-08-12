// frontend/src/app/estimates/[id]/page.tsx
'use client';
import EstimateForm from '@/components/EstimateForm';
import { useParams } from 'next/navigation';

export default function EditEstimatePage() {
  const params = useParams();
  const id = Array.isArray(params.id) ? params.id[0] : params.id;
  
  // Мы вызываем тот же самый универсальный компонент,
  // но передаем ему estimateId. Он сам загрузит данные и перейдет в режим редактирования.
  return <EstimateForm estimateId={id} />;
}