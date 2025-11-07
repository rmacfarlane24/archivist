import React, { useState, useEffect } from 'react';
import { useSubscription } from '../contexts/SubscriptionContext';
import ContactSupportModal from './ContactSupportModal';
import { supabaseClient } from '../supabase-client';

interface TrialExpiredBlockProps {
  darkMode: boolean;
  onSignOut: () => void;
}

interface CurrencyRate {
  currency: string;
  rate: number;
}

const TrialExpiredBlock: React.FC<TrialExpiredBlockProps> = ({ darkMode, onSignOut }) => {
  const { pricingPlans } = useSubscription();
  const [showContactModal, setShowContactModal] = useState(false);
  const [currencyRates, setCurrencyRates] = useState<CurrencyRate[]>([]);
  const [loadingRates, setLoadingRates] = useState(true);
  
  // Get user's preferred currency based on browser locale
  const getUserCurrency = (): string => {
    try {
      const locale = navigator.language || 'en-GB';
      if (locale.startsWith('en-US')) return 'USD';
      if (locale.startsWith('en-GB')) return 'GBP';
      if (locale.startsWith('de') || locale.startsWith('fr') || locale.startsWith('es') || locale.startsWith('it')) return 'EUR';
      return 'GBP'; // Default fallback
    } catch (e) {
      return 'GBP';
    }
  };

  const userCurrency = getUserCurrency();

  // Fetch real-time currency conversion rates
  useEffect(() => {
    const fetchCurrencyRates = async () => {
      try {
        setLoadingRates(true);
        const { data, error } = await supabaseClient.functions.invoke('currency-conversion');
        
        if (!error && data?.success && data?.rates) {
          setCurrencyRates(data.rates);
        } else if (error) {
          console.error('Currency conversion error:', error);
        }
      } catch (error) {
        console.error('Failed to fetch currency rates:', error);
        // Fallback to static rates
        setCurrencyRates([
          { currency: 'GBP', rate: 1 },
          { currency: 'USD', rate: 1.27 },
          { currency: 'EUR', rate: 1.17 }
        ]);
      } finally {
        setLoadingRates(false);
      }
    };

    fetchCurrencyRates();
  }, []);

  // Convert GBP to user's currency using real-time rates
  const convertPrice = (gbpAmount: number, targetCurrency: string): number => {
    const rate = currencyRates.find(r => r.currency === targetCurrency)?.rate || 1;
    return Math.round(gbpAmount * rate * 100) / 100; // Round to 2 decimal places
  };

  return (
    <div className={`fixed inset-0 z-[100] ${darkMode ? 'bg-black/80' : 'bg-custom-white/95'}`}>
      <div className="flex items-center justify-center min-h-screen p-4">
        <div className={`max-w-lg w-full rounded-lg shadow-xl p-8 ${darkMode ? 'bg-custom-black border border-gray-700' : 'bg-custom-white border border-gray-200'}`}>
          <div className="text-left">
            {/* App Name */}
            <div className="mb-6">
              <h1 className="font-bold text-4xl">
                archivist
              </h1>
            </div>
            
            <h2 className="text-xl font-semibold mb-3">Your 14-day Free Trial Has Ended</h2>
            <p className={`text-base mb-8 ${darkMode ? 'text-gray-300' : 'text-gray-600'}`}>
              To continue using Archivist, please choose a subscription plan.
            </p>
            
            {/* Plan Options */}
            <div className="space-y-4 mb-8">
              {pricingPlans.map((plan) => {
                const isYearly = plan.id === 'annual';
                const isLifetime = plan.id === 'lifetime';
                const monthlySavings = isYearly ? Math.round(((5 * 12) - plan.price) / (5 * 12) * 100) : 0;
                
                return (
                  <div
                    key={plan.id}
                    className={`p-4 rounded-lg border-2 cursor-pointer transition-all hover:shadow-md h-20 ${
                      isYearly 
                        ? darkMode 
                          ? 'border-blue-500 bg-blue-500/10 hover:border-blue-400' 
                          : 'border-blue-500 bg-blue-50 hover:border-blue-600'
                        : darkMode 
                          ? 'border-gray-600 hover:border-gray-500' 
                          : 'border-gray-200 hover:border-gray-300'
                    }`}
                    onClick={() => {
                      console.log('Opening Stripe checkout for plan:', plan.id);
                      window.open(plan.stripeUrl, '_blank');
                    }}
                  >
                    <div className="flex items-center justify-between">
                      <div className="text-left">
                        <div className="font-semibold text-lg">
                          {plan.id === 'annual' ? 'Yearly' : plan.name}
                        </div>
                        {isYearly && (
                          <div className="text-sm text-green-600 font-medium">
                            Save {monthlySavings}% vs Monthly
                          </div>
                        )}
                      </div>
                      <div className="text-right">
                        <div className="font-bold text-xl">
                          {loadingRates ? (
                            <div className="animate-pulse bg-gray-300 h-6 w-16 rounded"></div>
                          ) : (
                            <>
                              {userCurrency === 'USD' ? '$' : userCurrency === 'EUR' ? '€' : '£'}
                              {convertPrice(plan.price, userCurrency).toFixed(2)}
                            </>
                          )}
                        </div>
                        {isLifetime && (
                          <div className={`text-xs px-2 py-1 rounded-full mt-1 ${darkMode ? 'bg-blue-600 text-white' : 'bg-blue-500 text-white'}`}>
                            Limited Offer
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
            
            <div className={`text-sm ${darkMode ? 'text-gray-400' : 'text-gray-500'} mb-6`}>
              Clicking a plan will redirect you to Stripe's secure checkout page.<br />
              Prices exclude applicable regional taxes.
            </div>
            
            {/* Additional Options */}
            <div className="flex justify-start space-x-6 text-sm">
              <button
                onClick={() => setShowContactModal(true)}
                className={`${darkMode ? 'text-blue-400 hover:text-blue-300' : 'text-blue-600 hover:text-blue-500'} transition-colors`}
              >
                Support
              </button>
              <button
                onClick={onSignOut}
                className={`${darkMode ? 'text-red-400 hover:text-red-300' : 'text-red-600 hover:text-red-500'} transition-colors no-underline`}
              >
                Sign out
              </button>
            </div>
          </div>
        </div>
      </div>
      
      {/* Contact Support Modal */}
      <ContactSupportModal 
        isOpen={showContactModal}
        onClose={() => setShowContactModal(false)}
        darkMode={darkMode}
      />
    </div>
  );
};

export default TrialExpiredBlock;
