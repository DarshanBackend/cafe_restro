import PDFDocument from "pdfkit";
import hotelBookingModel from "../model/hotel.booking.model.js";
import restaurantBookingModel from "../model/restro.booking.model.js";
import cafeBookingModel from "../model/cafe.booking.model.js";
import hallBookingModel from "../model/hall.booking.model.js";
import { sendError } from "../utils/responseUtils.js";

const bookingModels = [
  { type: "Hotel", model: hotelBookingModel, populateKey: "hotelId" },
  { type: "Restaurant", model: restaurantBookingModel, populateKey: "restaurantId" },
  { type: "Cafe", model: cafeBookingModel, populateKey: "cafeId" },
  { type: "Hall", model: hallBookingModel, populateKey: "hallId" },
];


const formatCurrency = (amount, currency = 'INR') => {
  const formatter = new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: currency,
    minimumFractionDigits: 2,
  });
  return formatter.format(amount);
};


const formatDate = (date) => {
  return new Date(date).toLocaleDateString('en-IN', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });
};


const formatTime = (time) => {
  return new Date(`2000-01-01T${time}`).toLocaleTimeString('en-IN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: true
  });
};

export const downloadBookingInvoice = async (req, res) => {
  try {
    const { id } = req.params;
    const { _id: userId } = req.user;

    let booking = null;
    let bookingType = "";
    let businessKey = "";

    
    for (const { type, model, populateKey } of bookingModels) {
      const found = await model
        .findOne({ _id: id, userId })
        .populate("userId")
        .populate(populateKey)
        .lean();

      if (found) {
        booking = found;
        bookingType = type;
        businessKey = populateKey;
        break;
      }
    }

    if (!booking) return sendError(res, "Booking not found");

    const business = booking[businessKey] || {};
    const invoiceId = `INV-${booking.bookingId || booking._id.toString().slice(-8).toUpperCase()}`;
    const invoiceDate = new Date(booking.createdAt).toLocaleDateString("en-IN");

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename=${bookingType}-Invoice-${invoiceId}.pdf`
    );

    const doc = new PDFDocument({ margin: 50, size: 'A4' });
    doc.pipe(res);

    
    
    const pageWidth = doc.page.width;
    const leftMargin = 50;
    const rightMargin = pageWidth - 50; 

    doc.rect(0, 0, pageWidth, 100).fill("#1a365d");

    
    doc.fillColor("white")
      .fontSize(24)
      .font("Helvetica-Bold")
      .text("BOOKING INVOICE", leftMargin, 35);

    doc.fontSize(10)
      .text("Travel & Hospitality Services", leftMargin, 65)
      .text("contact@bookings.com | +91-9876543210", leftMargin, 80);

    
    const rightContentWidth = 220; 
    const rightContentStart = rightMargin - rightContentWidth;

    
    const lineHeight = 15;
    let rightY = 35;

    doc.fontSize(11)
      .font("Helvetica-Bold")
      .text(`Invoice:`, rightContentStart, rightY, {
        width: rightContentWidth,
        align: "right"
      })
      .font("Helvetica")
      .text(`${invoiceId}`, rightContentStart, rightY, {
        width: rightContentWidth - 60, 
        align: "right"
      });

    rightY += lineHeight;
    
    
    
    

    rightY += lineHeight;
    doc.text(`Type: ${bookingType}`, rightContentStart, rightY, {
      width: rightContentWidth,
      align: "right"
    });

    rightY += lineHeight;
    
    
    
    
    

    doc.moveDown(4);

    
    const sectionTop = doc.y;

    
    doc.rect(50, sectionTop, 250, 80).fill("#f7fafc").stroke("#e2e8f0");
    doc.fillColor("#2d3748")
      .fontSize(14)
      .font("Helvetica-Bold")
      .text("CUSTOMER DETAILS", 60, sectionTop + 10);

    doc.fillColor("#4a5568")
      .fontSize(10)
      .font("Helvetica")
      .text(`Name: ${booking.userId?.name || booking.guest?.name || "N/A"}`, 60, sectionTop + 30)
      .text(`Email: ${booking.userId?.email || booking.guest?.email || "N/A"}`, 60, sectionTop + 45)
      .text(`Phone: ${booking.userId?.contactNo || booking.guest?.phone || "N/A"}`, 60, sectionTop + 60);

    
    doc.rect(310, sectionTop, 240, 80).fill("#f7fafc").stroke("#e2e8f0");
    doc.fillColor("#2d3748")
      .fontSize(14)
      .font("Helvetica-Bold")
      .text(`${bookingType.toUpperCase()} DETAILS`, 320, sectionTop + 10);

    doc.fillColor("#4a5568")
      .fontSize(10)
      .text(`Name: ${business.name || "N/A"}`, 320, sectionTop + 30)
      .text(`Address: ${getBusinessAddress(business, bookingType)}`, 320, sectionTop + 45)
      .text(`Contact: ${getBusinessContact(business)}`, 320, sectionTop + 60);

    doc.moveDown(6);

    
    doc.fillColor("#2d3748")
      .fontSize(16)
      .font("Helvetica-Bold")
      .text("BOOKING INFORMATION", 50, doc.y);

    
    const bookingDetails = getBookingDetails(booking, bookingType);
    const tableTop = doc.y + 20;

    
    doc.rect(50, tableTop, 500, 25).fill("#2d3748");
    doc.fillColor("white")
      .fontSize(11)
      .font("Helvetica-Bold")
      .text("Description", 60, tableTop + 8)
      .text("Details", 300, tableTop + 8);

    let currentY = tableTop + 25;

    
    bookingDetails.forEach((detail, index) => {
      const bgColor = index % 2 === 0 ? "#f7fafc" : "#ffffff";
      doc.rect(50, currentY, 500, 20).fill(bgColor).stroke("#e2e8f0");

      doc.fillColor("#2d3748")
        .fontSize(9)
        .font("Helvetica-Bold")
        .text(detail.label, 60, currentY + 6);

      doc.fillColor("#4a5568")
        .fontSize(9)
        .font("Helvetica")
        .text(detail.value, 300, currentY + 6);

      currentY += 20;
    });

    doc.y = currentY + 30;

    
    doc.fillColor("#2d3748")
      .fontSize(16)
      .font("Helvetica-Bold")
      .text("PAYMENT SUMMARY", 50, doc.y);

    const paymentDetails = getPaymentDetails(booking, bookingType);
    const paymentTableTop = doc.y + 20;

    
    doc.rect(50, paymentTableTop, 500, 25).fill("#2d3748");
    doc.fillColor("white")
      .fontSize(11)
      .font("Helvetica-Bold")
      .text("Description", 60, paymentTableTop + 8)
      .text("Amount", 400, paymentTableTop + 8, { align: "right" });

    let paymentY = paymentTableTop + 25;

    
    paymentDetails.forEach((item, index) => {
      const bgColor = index % 2 === 0 ? "#f7fafc" : "#ffffff";
      doc.rect(50, paymentY, 500, 20).fill(bgColor).stroke("#e2e8f0");

      doc.fillColor(item.bold ? "#2d3748" : "#4a5568")
        .fontSize(item.bold ? 10 : 9)
        .font(item.bold ? "Helvetica-Bold" : "Helvetica")
        .text(item.label, 60, paymentY + 6);

      doc.text(item.amount, 400, paymentY + 6, { align: "right" });

      paymentY += 20;
    });

    doc.y = paymentY + 40;

    
    const paymentStatus = booking.payment?.paymentStatus || booking.paymentStatus || 'pending';
    const statusColor = paymentStatus === 'completed' ? '#38a169' :
      paymentStatus === 'pending' ? '#d69e2e' : '#e53e3e';

    doc.fillColor(statusColor)
      .fontSize(12)
      .font("Helvetica-Bold")
      .text(`Payment Status: ${paymentStatus.toUpperCase()}`, 50, doc.y);

    if (booking.payment?.transactionId) {
      doc.fillColor("#4a5568")
        .fontSize(10)
        .text(`Transaction ID: ${booking.payment.transactionId}`, 50, doc.y + 15);
    }

    doc.moveDown(3);

    
    doc.fillColor("#2d3748")
      .fontSize(12)
      .font("Helvetica-Bold")
      .text("Terms & Conditions:", 50, doc.y);

    doc.fillColor("#4a5568")
      .fontSize(9)
      .font("Helvetica")
      .text(getTermsAndConditions(bookingType), 50, doc.y + 15, {
        width: 500,
        align: "justify"
      });

    doc.moveDown(4);

    
    doc.fillColor("#718096")
      .fontSize(8)
      .text("Thank you for your booking! For any queries, contact support@bookings.com",
        50, doc.y, { align: "center" })
      .text("This is a computer-generated invoice and does not require a physical signature.",
        50, doc.y + 12, { align: "center" });

    doc.end();
  } catch (error) {
    console.error("Invoice Generation Error:", error);
    return sendError(res, error.message || "Error generating invoice");
  }
};


const getBusinessAddress = (business, type) => {
  switch (type) {
    case 'Restaurant':
      return `${business.address?.street}, ${business.address?.city}`;
    case 'Cafe':
      return `${business.location?.address}, ${business.location?.city}`;
    case 'Hotel':
      return `${business.address?.street}, ${business.address?.city}`;
    case 'Hall':
      return business.address;
    default:
      return 'N/A';
  }
};

const getBusinessContact = (business) => {
  if (business.contact?.phone) return business.contact.phone;
  if (business.contactNo) return business.contactNo;
  return 'N/A';
};

const getBookingDetails = (booking, type) => {
  const details = [];

  details.push({ label: "Booking Reference", value: booking.bookingId });
  details.push({ label: "Booking Status", value: booking.bookingStatus || booking.status || "Confirmed" });

  switch (type) {
    case 'Restaurant':
      details.push({ label: "Booking Date", value: formatDate(booking.bookingDate) });
      details.push({ label: "Time Slot", value: `${booking.timeSlot?.startTime} - ${booking.timeSlot?.endTime}` });
      details.push({ label: "Number of Guests", value: booking.numberOfGuests.toString() });
      details.push({ label: "Table Number", value: booking.tableNumber || "N/A" });
      if (booking.guestInfo?.specialRequests) {
        details.push({ label: "Special Requests", value: booking.guestInfo.specialRequests });
      }
      break;

    case 'Cafe':
      details.push({ label: "Booking Date", value: formatDate(booking.bookingDate) });
      details.push({ label: "Time Slot", value: booking.timeSlot });
      details.push({ label: "Number of Guests", value: booking.numberOfGuests.toString() });
      if (booking.guestInfo?.specialRequests) {
        details.push({ label: "Special Requests", value: booking.guestInfo.specialRequests });
      }
      break;

    case 'Hotel':
      details.push({ label: "Check-in Date", value: formatDate(booking.bookingDates?.checkInDate) });
      details.push({ label: "Check-out Date", value: formatDate(booking.bookingDates?.checkOutDate) });
      details.push({ label: "Number of Nights", value: booking.bookingDates?.numberOfNights.toString() });
      details.push({ label: "Guests", value: `${booking.guestInfo?.adults || 0} Adults, ${booking.guestInfo?.children || 0} Children` });
      if (booking.guestInfo?.specialRequests) {
        details.push({ label: "Special Requests", value: booking.guestInfo.specialRequests });
      }
      break;

    case 'Hall':
      details.push({ label: "Event Date", value: formatDate(booking.startDate) });
      details.push({ label: "Time Slot", value: `${booking.startTime} - ${booking.endTime}` });
      details.push({ label: "Duration", value: `${booking.totalDays} day(s)` });
      if (booking.specialRequests) {
        details.push({ label: "Special Requirements", value: booking.specialRequests });
      }
      break;
  }

  return details;
};

const getPaymentDetails = (booking, type) => {
  const items = [];
  let currency = 'INR';

  switch (type) {
    case 'Restaurant':
      currency = booking.billing?.currency || 'INR';
      items.push({ label: "Base Amount", amount: formatCurrency(booking.billing?.baseAmount || 0, currency) });
      if (booking.billing?.discount?.amount > 0) {
        items.push({
          label: `Discount (${booking.billing.discount.percentage}%)`,
          amount: `-${formatCurrency(booking.billing.discount.amount, currency)}`
        });
      }
      if (booking.billing?.taxAmount > 0) {
        items.push({
          label: `Tax (${booking.billing.taxPercentage}%)`,
          amount: formatCurrency(booking.billing.taxAmount, currency)
        });
      }
      if (booking.billing?.teamService > 0) {
        items.push({ label: "Service Charge", amount: formatCurrency(booking.billing.teamService, currency) });
      }
      items.push({ label: "Total Amount", amount: formatCurrency(booking.billing?.totalAmount || 0, currency), bold: true });
      break;

    case 'Cafe':
      currency = booking.pricing?.currency || 'USD';
      items.push({ label: "Per Guest Rate", amount: formatCurrency(booking.pricing?.perGuestRate || 0, currency) });
      items.push({ label: "Total Guest Rate", amount: formatCurrency(booking.pricing?.totalGuestRate || 0, currency) });
      if (booking.pricing?.discountAmount > 0) {
        items.push({ label: "Discount", amount: `-${formatCurrency(booking.pricing.discountAmount, currency)}` });
      }
      if (booking.pricing?.taxAmount > 0) {
        items.push({
          label: `Tax (${booking.pricing.taxPercentage}%)`,
          amount: formatCurrency(booking.pricing.taxAmount, currency)
        });
      }
      if (booking.pricing?.serviceFee > 0) {
        items.push({ label: "Service Fee", amount: formatCurrency(booking.pricing.serviceFee, currency) });
      }
      items.push({ label: "Total Amount", amount: formatCurrency(booking.pricing?.totalAmount || 0, currency), bold: true });
      break;

    case 'Hotel':
      currency = booking.pricing?.currency || 'INR';
      items.push({ label: "Room Rate per Night", amount: formatCurrency(booking.pricing?.roomRatePerNight || 0, currency) });
      items.push({ label: "Total Room Rate", amount: formatCurrency(booking.pricing?.totalRoomRate || 0, currency) });
      if (booking.pricing?.discountAmount > 0) {
        items.push({ label: "Discount", amount: `-${formatCurrency(booking.pricing.discountAmount, currency)}` });
      }
      if (booking.pricing?.taxAmount > 0) {
        items.push({
          label: `Tax (${booking.pricing.taxPercentage}%)`,
          amount: formatCurrency(booking.pricing.taxAmount, currency)
        });
      }
      if (booking.pricing?.serviceFee > 0) {
        items.push({ label: "Service Fee", amount: formatCurrency(booking.pricing.serviceFee, currency) });
      }
      items.push({ label: "Total Amount", amount: formatCurrency(booking.pricing?.totalAmount || 0, currency), bold: true });
      break;

    case 'Hall':
      items.push({ label: "Base Price", amount: formatCurrency(booking.basePrice || 0) });
      if (booking.discountAmount > 0) {
        items.push({
          label: `Discount (${booking.discountPercentage}%)`,
          amount: `-${formatCurrency(booking.discountAmount)}`
        });
      }
      if (booking.taxAmount > 0) {
        items.push({ label: "Tax Amount", amount: formatCurrency(booking.taxAmount) });
      }
      items.push({ label: "Final Amount", amount: formatCurrency(booking.finalAmount || 0), bold: true });
      break;
  }

  return items;
};

const getTermsAndConditions = (type) => {
  const baseTerms = "• This invoice is generated automatically and is valid without signature. ";
  const specificTerms = {
    'Restaurant': "• Cancellation allowed up to 2 hours before booking time. • Late arrivals may result in table reassignment.",
    'Cafe': "• Reservation held for 15 minutes past booking time. • Outside food and beverages not allowed.",
    'Hotel': "• Standard check-in: 2:00 PM, check-out: 12:00 PM. • Early check-in/late check-out subject to availability and charges.",
    'Hall': "• 50% advance payment required for confirmation. • Cancellation policy: 7 days notice for full refund."
  };

  return baseTerms + (specificTerms[type] || "• Please contact support for specific terms and conditions.");
};