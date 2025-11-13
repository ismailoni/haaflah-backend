import { Participant, Event } from '../models/index.js';
import { Op } from 'sequelize';
import crypto from 'crypto';
import { addEmailJob } from '../queues/emailQueue.js';
import { registrationConfirmationTemplate } from '../utils/emailTemplates.js';

// ------------------------ REGISTER PARTICIPANT ------------------------
export const registerParticipant = async (req, res) => {
  try {
    const { eventId } = req.params;
    const event = await Event.findByPk(eventId);

    if (!event) return res.status(404).json({ error: 'Event not found' });
    if (event.status !== 'published') {
      return res.status(400).json({ error: 'Event is not open for registration' });
    }

    // Check capacity
    if (event.capacity && event.totalRegistrations >= event.capacity) {
      return res.status(400).json({ error: 'Event is at full capacity' });
    }

    // Check if already registered
    const existing = await Participant.findOne({
      where: { eventId, email: req.body.email },
    });
    if (existing) {
      return res.status(400).json({ error: 'Already registered for this event' });
    }

    // Generate unique ticket number
    const ticketNumber = `TKT-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;

    const participant = await Participant.create({
      ...req.body,
      eventId,
      ticketNumber,
      status: event.requiresApproval ? 'registered' : 'confirmed',
    });

    // Update event registration count
    await event.increment('totalRegistrations');

    // Send confirmation email via queue
    const html = registrationConfirmationTemplate({
      name: `${participant.firstName} ${participant.lastName}`,
      eventName: event.name,
      eventDate: event.date,
      eventVenue: event.venue,
      ticketNumber: participant.ticketNumber,
    });

    await addEmailJob({
      to: participant.email,
      subject: `✅ Registration Confirmed - ${event.name}`,
      html,
    });

    res.status(201).json({ participant, message: 'Registration successful' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to register participant' });
  }
};

// ------------------------ GET ALL PARTICIPANTS FOR EVENT ------------------------
export const getEventParticipants = async (req, res) => {
  try {
    const { eventId } = req.params;
    const { status, checkedIn, search, page = 1, limit = 50 } = req.query;
    const offset = (page - 1) * limit;

    const event = await Event.findByPk(eventId);
    if (!event) return res.status(404).json({ error: 'Event not found' });

    // Check authorization
    if (event.organizerId !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Access denied' });
    }

    const where = { eventId };
    if (status) where.status = status;
    if (checkedIn !== undefined) where.checkedIn = checkedIn === 'true';
    if (search) {
      where[Op.or] = [
        { firstName: { [Op.iLike]: `%${search}%` } },
        { lastName: { [Op.iLike]: `%${search}%` } },
        { email: { [Op.iLike]: `%${search}%` } },
      ];
    }

    const { count, rows } = await Participant.findAndCountAll({
      where,
      limit: parseInt(limit),
      offset: parseInt(offset),
      order: [['registrationDate', 'DESC']],
    });

    res.json({
      participants: rows,
      total: count,
      page: parseInt(page),
      totalPages: Math.ceil(count / limit),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch participants' });
  }
};

// ------------------------ GET PARTICIPANT BY ID ------------------------
export const getParticipantById = async (req, res) => {
  try {
    const { id } = req.params;
    const participant = await Participant.findByPk(id, {
      include: [{ model: Event, as: 'event', attributes: ['id', 'name', 'date', 'venue'] }],
    });

    if (!participant) return res.status(404).json({ error: 'Participant not found' });

    // Check authorization
    const event = await Event.findByPk(participant.eventId);
    if (event.organizerId !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Access denied' });
    }

    res.json({ participant });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch participant' });
  }
};

// ------------------------ UPDATE PARTICIPANT ------------------------
export const updateParticipant = async (req, res) => {
  try {
    const { id } = req.params;
    const participant = await Participant.findByPk(id);

    if (!participant) return res.status(404).json({ error: 'Participant not found' });

    // Check authorization
    const event = await Event.findByPk(participant.eventId);
    if (event.organizerId !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Access denied' });
    }

    await participant.update(req.body);
    res.json({ participant });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update participant' });
  }
};

// ------------------------ DELETE PARTICIPANT ------------------------
export const deleteParticipant = async (req, res) => {
  try {
    const { id } = req.params;
    const participant = await Participant.findByPk(id);

    if (!participant) return res.status(404).json({ error: 'Participant not found' });

    // Check authorization
    const event = await Event.findByPk(participant.eventId);
    if (event.organizerId !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Access denied' });
    }

    await participant.destroy();
    await event.decrement('totalRegistrations');

    res.json({ message: 'Participant deleted successfully' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to delete participant' });
  }
};

// ------------------------ CHECK IN PARTICIPANT ------------------------
export const checkInParticipant = async (req, res) => {
  try {
    const { id } = req.params;
    const { checkInMethod = 'manual' } = req.body;

    const participant = await Participant.findByPk(id);
    if (!participant) return res.status(404).json({ error: 'Participant not found' });

    // Check authorization
    const event = await Event.findByPk(participant.eventId);
    if (event.organizerId !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Access denied' });
    }

    if (participant.checkedIn) {
      return res.status(400).json({ error: 'Participant already checked in' });
    }

    await participant.update({
      checkedIn: true,
      checkInTime: new Date(),
      checkInMethod,
      status: 'attended',
    });

    await event.increment('totalAttendees');

    res.json({ participant, message: 'Check-in successful' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to check in participant' });
  }
};

// ------------------------ BULK CHECK IN ------------------------
export const bulkCheckIn = async (req, res) => {
  try {
    const { participantIds, checkInMethod = 'manual' } = req.body;

    if (!participantIds || !Array.isArray(participantIds)) {
      return res.status(400).json({ error: 'participantIds must be an array' });
    }

    const participants = await Participant.findAll({
      where: { id: participantIds },
    });

    if (participants.length === 0) {
      return res.status(404).json({ error: 'No participants found' });
    }

    // Check authorization for the first participant's event
    const event = await Event.findByPk(participants[0].eventId);
    if (event.organizerId !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Access denied' });
    }

    const updated = [];
    for (const participant of participants) {
      if (!participant.checkedIn) {
        await participant.update({
          checkedIn: true,
          checkInTime: new Date(),
          checkInMethod,
          status: 'attended',
        });
        updated.push(participant);
      }
    }

    await event.increment('totalAttendees', { by: updated.length });

    res.json({ message: `${updated.length} participants checked in`, updated });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to bulk check in' });
  }
};


