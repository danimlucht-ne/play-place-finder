import LegalDocPage from '../components/LegalDocPage';
import { getLegalMetadata } from '../../lib/readLegalDoc';

export async function generateMetadata() {
  return getLegalMetadata('advertiser-agreement');
}

export default function AdvertiserAgreement() {
  return <LegalDocPage slug="advertiser-agreement" footer="withAdvertise" />;
}
