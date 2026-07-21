'use client';

import ReportBookedCustomers from './ReportBookedCustomers';
import ReportAvailableSlots from './ReportAvailableSlots';

export default function ReportsTab() {
  return (
    <div className="space-y-6">
      <ReportBookedCustomers />
      <ReportAvailableSlots />
    </div>
  );
}
