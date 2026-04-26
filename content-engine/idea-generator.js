const { loadAdaptiveConfig } = require('./learning/adaptive-config');

// Banco base de situaciones reales por vertical.
const CATEGORY_LIBRARY = {
  mobile: {
    topic: 'mobile',
    situations: [
      {
        title: 'El mensaje que relees demasiado',
        situation: 'Estás en la cama y vuelves a abrir el mismo chat.',
        action: 'Lees un mensaje corto otra vez.',
        microAction: 'Pausas el dedo encima del texto y vuelves arriba.',
        twist: 'El mensaje no cambia, cambia el miedo con el que lo lees.',
        pain: 'Necesitas una prueba que te calme y acabas encontrando otra duda.',
        identity: 'Le pasa a quien aparenta estar tranquilo pero piensa demasiado.',
        monetizationAngle: 'Encaja con series sobre apego, ansiedad y relaciones.'
      },
      {
        title: 'La notificación que no abres',
        situation: 'Te entra una notificación cuando estás trabajando.',
        action: 'Miras la pantalla sin abrirla.',
        microAction: 'Bloqueas el móvil y lo vuelves a encender diez segundos después.',
        twist: 'No reaccionas al mensaje, reaccionas a la historia que inventaste.',
        pain: 'Tu cuerpo responde antes de que tengas datos reales.',
        identity: 'Le pasa a quien vive pendiente de señales pequeñas.',
        monetizationAngle: 'Sirve para formatos sobre ansiedad funcional y regulación.'
      },
      {
        title: 'El audio que suena distinto cada vez',
        situation: 'Te mandan un audio de cinco segundos.',
        action: 'Lo escuchas varias veces seguidas.',
        microAction: 'Subes el volumen en la segunda escucha.',
        twist: 'La voz es la misma, pero ya no oyes palabras: oyes distancia.',
        pain: 'Intentas confirmar una sospecha emocional con un detalle técnico.',
        identity: 'Le pasa a quien detecta tonos antes que frases.',
        monetizationAngle: 'Abre líneas de contenido sobre hiperlectura emocional.'
      }
    ]
  },
  relationships: {
    topic: 'relationships',
    situations: [
      {
        title: 'El cambio de tono en una cena',
        situation: 'Alguien te contesta normal delante de otros y raro al salir.',
        action: 'Repasas una frase aparentemente simple.',
        microAction: 'Te quedas callado un segundo más de lo normal.',
        twist: 'No te dolió la frase; te dolió lo que implicaba.',
        pain: 'Tu cabeza rellena la parte que nadie se atreve a decir.',
        identity: 'Le pasa a quien detecta tensiones que otros fingen no ver.',
        monetizationAngle: 'Conecta con pareja, apego y conflicto silencioso.'
      },
      {
        title: 'Cuando te responden tarde pero miras la hora exacta',
        situation: 'Ves la hora del mensaje antes de leerlo.',
        action: 'Comparas cuánto tardó con otras veces.',
        microAction: 'Deslizas el chat hacia arriba buscando conversaciones antiguas.',
        twist: 'No estás leyendo una respuesta; estás midiendo tu lugar.',
        pain: 'Buscas cariño en patrones de tiempo imposibles de controlar.',
        identity: 'Le pasa a quien convierte pequeños cambios en señales grandes.',
        monetizationAngle: 'Muy útil para series de apego y validación.'
      },
      {
        title: 'El gesto pequeño que te cambia el día',
        situation: 'Una persona a la que quieres te ve y no sonríe como siempre.',
        action: 'Intentas actuar normal.',
        microAction: 'Recreas la escena exacta de dos segundos en tu cabeza.',
        twist: 'No recuerdas el gesto: recuerdas lo que temiste significaba.',
        pain: 'Una microseñal puede activar inseguridades viejas muy rápido.',
        identity: 'Le pasa a quien está atento a cambios mínimos en los demás.',
        monetizationAngle: 'Perfecto para contenido de señales, apego y autoestima.'
      }
    ]
  },
  habits: {
    topic: 'habits',
    situations: [
      {
        title: 'Cuando dices mañana empiezo',
        situation: 'Dejas la ropa del gimnasio preparada por la noche.',
        action: 'Apagas la alarma cuando suena.',
        microAction: 'Miras la hora, haces una cuenta rápida y vuelves a cerrar los ojos.',
        twist: 'No falló tu disciplina; ganó tu versión de cinco minutos.',
        pain: 'Pierdes contra decisiones pequeñas que parecen inocentes.',
        identity: 'Le pasa a quien quiere cambiar mucho pero negocia en corto.',
        monetizationAngle: 'Sirve para hábitos, foco y mejora personal comercializable.'
      },
      {
        title: 'El vídeo más antes de dormir',
        situation: 'Estás cansado y dices que verás solo un vídeo.',
        action: 'Deslizas una vez más.',
        microAction: 'Ajustas la almohada y dejas el cargador más cerca.',
        twist: 'No buscabas entretenimiento; buscabas no quedarte a solas contigo.',
        pain: 'El cansancio baja tu control y sube la evasión.',
        identity: 'Le pasa a quien usa pantallas para apagar el ruido mental.',
        monetizationAngle: 'Conecta con sueño, dopamina y hábitos digitales.'
      },
      {
        title: 'El café que no era por sueño',
        situation: 'Te haces otro café sin pensar.',
        action: 'Lo tomas mientras abres otra tarea.',
        microAction: 'Das el primer sorbo antes de sentarte.',
        twist: 'No querías energía; querías sentir que arrancabas de nuevo.',
        pain: 'Confundes activación emocional con productividad.',
        identity: 'Le pasa a quien intenta reiniciar el día varias veces.',
        monetizationAngle: 'Entra bien en contenidos de estrés, foco y rendimiento.'
      }
    ]
  },
  decisions: {
    topic: 'decisions',
    situations: [
      {
        title: 'La pestaña que dejas abierta',
        situation: 'Vas a comprar algo y comparas demasiadas opciones.',
        action: 'Saltas entre tres pestañas parecidas.',
        microAction: 'Añades una al carrito y la quitas enseguida.',
        twist: 'No estabas eligiendo mejor; estabas retrasando el miedo a equivocarte.',
        pain: 'Tener más opciones no te calma, te drena.',
        identity: 'Le pasa a quien quiere control y termina agotado.',
        monetizationAngle: 'Permite hablar de compra, elección y fatiga mental.'
      },
      {
        title: 'El mensaje que escribes y borras',
        situation: 'Necesitas decir algo incómodo.',
        action: 'Escribes una respuesta y la borras varias veces.',
        microAction: 'Cambias una palabra para sonar menos intenso.',
        twist: 'No estás editando el mensaje; estás editando cómo te verán.',
        pain: 'La indecisión suele esconder miedo social, no falta de ideas.',
        identity: 'Le pasa a quien piensa mucho antes de exponerse.',
        monetizationAngle: 'Muy fuerte para comunicación, autoestima y relaciones.'
      },
      {
        title: 'La elección simple que te agota',
        situation: 'Miras el menú y tardas demasiado en pedir.',
        action: 'Lees lo mismo dos veces.',
        microAction: 'Preguntas qué pidió otra persona antes de decidir.',
        twist: 'A veces no eliges lo que quieres; eliges lo que menos te compromete.',
        pain: 'La decisión pequeña activa el miedo a arrepentirte después.',
        identity: 'Le pasa a quien vive anticipando la opción mejor.',
        monetizationAngle: 'Se puede llevar a ansiedad, perfeccionismo y control.'
      }
    ]
  }
};

// Prioriza ideas con escena clara, acción visible y aprendizaje acumulado.
function _scoreIdea(idea, adaptiveConfig = {}) {
  let score = 0;
  if (idea.situation) score += 25;
  if (idea.action) score += 20;
  if (idea.microAction) score += 20;
  if (idea.twist) score += 20;
  if (idea.pain) score += 10;
  if (idea.identity) score += 5;
  if (adaptiveConfig.microActionRequired && idea.microAction) score += 5;
  score += idea.learningBoost || 0;
  score -= idea.learningPenalty || 0;
  return score;
}

// Genera y ordena ideas listas para pasar a guion.
function generateIdeas(options = {}) {
  const adaptiveConfig = loadAdaptiveConfig();
  const requestedTopic = options.topic || null;
  const categories = Object.values(CATEGORY_LIBRARY)
    .filter((category) => !requestedTopic || category.topic === requestedTopic || category.topic.includes(requestedTopic));

  const selectedCategories = categories.length > 0 ? categories : Object.values(CATEGORY_LIBRARY);
  const boostedThemes = new Set(adaptiveConfig.boostThemes || []);
  const avoidedThemes = new Set(adaptiveConfig.avoidThemes || []);

  const ideas = selectedCategories.flatMap((category) =>
    category.situations.map((item, index) => {
      const idea = {
        id: `${category.topic}-${index + 1}`,
        category: category.topic,
        ...item,
        learningBoost: boostedThemes.has(category.topic) ? 18 : 0,
        learningPenalty: avoidedThemes.has(category.topic) ? 25 : 0,
        preferredByLearning: boostedThemes.has(category.topic)
      };

      return {
        ...idea,
        ideaScore: _scoreIdea(idea, adaptiveConfig)
      };
    })
  );

  return ideas.sort((a, b) => b.ideaScore - a.ideaScore);
}

module.exports = {
  generateIdeas
};
