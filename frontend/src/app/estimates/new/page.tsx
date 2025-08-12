// frontend/src/app/estimates/new/page.tsx
import EstimateForm from '@/components/EstimateForm';

export default function NewEstimatePage() {
  // Мы просто вызываем универсальный компонент без estimateId,
  // и он автоматически переходит в режим создания.
  return <EstimateForm />;
}