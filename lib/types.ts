export interface WorkOrder {
  id: string;
  customerName: string;
  address: string;
  latitude: number;
  longitude: number;
  appointmentWindow: { from: string; to: string };
  serviceType: string;
  estimatedDuration: number; // minutes
  status: "Pending" | "Scheduled" | "Completed";
  notes?: string;
}

export interface Technician {
  id: string;
  name: string;
  skills: string[];
  homeBase: {
    address: string;
    latitude: number;
    longitude: number;
  };
  shiftStart: string;
  shiftEnd: string;
  phone: string;
}
