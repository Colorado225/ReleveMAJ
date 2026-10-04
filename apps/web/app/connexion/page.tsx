import { redirect } from 'next/navigation';
import { OtpForm } from '@/components/otp-form';
import { getSessionUser } from '@/lib/auth';

export default async function LoginPage() {
  const session = await getSessionUser();
  if (session) redirect('/');
  return <OtpForm />;
}