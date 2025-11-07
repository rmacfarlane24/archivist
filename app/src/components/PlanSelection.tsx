import React, { useState } from 'react';
import { PricingPlan, PRICING_PLANS } from '../types/subscription';
import { useAuth } from '../contexts/AuthContext';

interface PlanSelectionProps {
  isOpen: boolean;
  onClose: () => void;
  onPlanSelected: (plan: PricingPlan) => void;
}

export const PlanSelection: React.FC<PlanSelectionProps> = ({
  isOpen,
  onClose
}) => {
  const { user, session } = useAuth();
  const userEmail = user?.email || '';
  const [selectedPlan, setSelectedPlan] = useState<PricingPlan | null>(null);

  if (!isOpen) return null;

  const handlePlanSelect = (plan: PricingPlan) => {
    setSelectedPlan(plan);
  };

  const handleCheckout = async () => {
    if (!selectedPlan) return;

    try {
      // Call the Supabase checkout function to get the checkout URL
      const sessionToken = session?.access_token;
      
      if (!sessionToken) {
        throw new Error('No valid session token available');
      }
      
      const response = await fetch('https://xslphflkpeyfqcwwlrih.supabase.co/functions/v1/checkout', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${sessionToken}`,
        },
        body: JSON.stringify({
          plan: selectedPlan.id,
          user_id: user?.id,
          email: userEmail
        })
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(`Failed to create checkout session: ${errorData.error || 'Unknown error'}`);
      }

      const data = await response.json();
      
      if (data.success && data.checkout_url) {
        window.open(data.checkout_url, '_blank');
        onClose();
      } else {
        throw new Error('Invalid response from checkout function');
      }
    } catch (error) {
      console.error('Checkout error:', error);
      // You might want to show an error message to the user
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
      <div className="bg-custom-white dark:bg-custom-black rounded-lg shadow-xl max-w-4xl w-full mx-4 max-h-[90vh] overflow-y-auto">
        <div className="p-6">
          <div className="flex justify-between items-center mb-6">
            <h2 className="text-2xl font-bold text-custom-black dark:text-white">
              Choose Your Plan
            </h2>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <div className="grid md:grid-cols-3 gap-6">
            {PRICING_PLANS.map((plan) => (
              <div
                key={plan.id}
                className={`relative rounded-lg border p-6 cursor-pointer transition-colors ${
                  selectedPlan?.id === plan.id
                    ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                    : plan.popular
                    ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                    : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'
                }`}
                onClick={() => handlePlanSelect(plan)}
              >
                {plan.popular && (
                  <div className="absolute -top-3 left-1/2 transform -translate-x-1/2">
                    <span className="bg-blue-500 text-white px-3 py-1 rounded-full text-sm font-medium">
                      Most Popular
                    </span>
                  </div>
                )}



                <div className="text-center">
                  <h3 className="text-xl font-semibold text-custom-black dark:text-white mb-2">
                    {plan.name}
                  </h3>
                  <div className="mb-4">
                    <span className="text-3xl font-bold text-custom-black dark:text-white">
                      £{plan.price}
                    </span>
                    {plan.interval && plan.interval !== 'lifetime' && (
                      <span className="text-gray-500 dark:text-gray-400">/{plan.interval}</span>
                    )}
                  </div>
                  <p className="text-gray-600 dark:text-gray-300 mb-4">
                    {plan.description}
                  </p>
                </div>

                <ul className="space-y-3 mb-6">
                  {plan.features.map((feature, index) => (
                    <li key={index} className="flex items-center">
                      <svg className="w-5 h-5 text-green-500 mr-3" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                      </svg>
                      <span className="text-gray-700 dark:text-gray-300">{feature}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>

          <div className="mt-6 text-center">
            <button
              onClick={handleCheckout}
              disabled={!selectedPlan}
              className={`flex items-center gap-2 mx-auto px-6 py-3 rounded-md font-medium transition-colors ${
                selectedPlan
                  ? 'bg-blue-600 hover:bg-blue-700 text-white'
                  : 'bg-gray-300 dark:bg-gray-600 text-gray-500 dark:text-gray-400 cursor-not-allowed'
              }`}
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
              </svg>
              Go to Checkout
            </button>
          </div>

          <div className="mt-6 text-center text-sm text-gray-500 dark:text-gray-400">
            <p>All prices exclude applicable taxes. Cancel anytime.</p>
            {userEmail && (
              <p className="mt-2">
                Your email ({userEmail}) will be pre-filled in the checkout.
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};


