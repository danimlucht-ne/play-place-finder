import LegalDocPage from '../components/LegalDocPage';
import { getLegalMetadata } from '../../lib/readLegalDoc';

export async function generateMetadata() {
  return getLegalMetadata('terms');
}

export default function Terms() {
  return <LegalDocPage slug="terms" />;
}
