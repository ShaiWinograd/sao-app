import { SignUp } from '@clerk/nextjs';
import { House } from 'lucide-react';

export default function SignUpPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-indigo-100 p-4">
      <div className="w-full max-w-md">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-2 mb-2">
            <span className="w-9 h-9 rounded-lg border border-gray-300 bg-white flex items-center justify-center">
              <House className="w-4 h-4 text-gray-800" />
            </span>
            <h1 className="text-4xl font-bold text-gray-900">SAO</h1>
          </div>
          <p className="text-lg text-gray-600">Space & Order</p>
          <p className="text-sm text-gray-500 mt-2">מערכת ניהול כוח אדם ותזמון משמרות</p>
        </div>

        {/* Sign Up Card */}
        <div className="bg-white rounded-lg shadow-lg p-8">
          <SignUp
            routing="path"
            path="/sign-up"
            forceRedirectUrl="/"
            appearance={{
              elements: {
                rootBox: 'w-full',
                card: 'shadow-none border-0',
                formButtonPrimary:
                  'bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2 px-4 rounded-lg w-full transition-colors',
                formFieldInput:
                  'w-full px-4 py-2 border border-gray-300 rounded-lg focus:border-blue-500 focus:ring-1 focus:ring-blue-500 text-right',
                formFieldLabel: 'text-right text-gray-700 text-sm font-medium',
                dividerLine: 'bg-gray-200',
                dividerText: 'text-gray-500',
                socialButtonsBlockButton:
                  'border border-gray-300 rounded-lg font-medium text-gray-700 hover:bg-gray-50 transition-colors',
                socialButtonsBlockButtonText: 'text-right',
                headerTitle: 'hidden',
                headerSubtitle: 'hidden',
              },
              layout: {
                socialButtonsPlacement: 'bottom',
                socialButtonsVariant: 'blockButton',
              },
            }}
          />
        </div>

        {/* Footer */}
        <p className="text-center text-xs text-gray-500 mt-6">
          יצירת חשבון חדש למנהלי משמרות
        </p>
      </div>
    </div>
  );
}
