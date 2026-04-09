import LegalDocPage from '../components/LegalDocPage';
import { getLegalMetadata } from '../../lib/readLegalDoc';

export async function generateMetadata() {
  return getLegalMetadata('privacy');
}

export default function Privacy() {
  return <LegalDocPage slug="privacy" />;
}
