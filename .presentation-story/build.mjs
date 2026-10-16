import fs from 'node:fs/promises';
import {Presentation, PresentationFile} from '@oai/artifact-tool';
import {finalizePresentation} from '/Users/abulkasimovbakhtiyar/.codex/plugins/cache/openai-primary-runtime/presentations/26.1013.11914/skills/presentations/container_tools/artifact_tool_utils.mjs';
const root='/Users/abulkasimovbakhtiyar/IdeaProjects/adal-ai', dir=root+'/.presentation-story';
const sk='/Users/abulkasimovbakhtiyar/.codex/plugins/cache/openai-primary-runtime/presentations/26.1013.11914/skills/presentations';
process.env.RUNTIME_NODE_MODULES='/Users/abulkasimovbakhtiyar/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules';
const P=Presentation.create({slideSize:{width:1280,height:720}});
const C={bg:'#F3F2EB',ink:'#103A3C',mute:'#526765',teal:'#087F7B',mint:'#A6E7D2',white:'#FFFFFF',gold:'#EBC784',night:'#082B30'};
const photos={almaty:'Bekarys Khozhanazar, https://unsplash.com/photos/Is8ARHv0ODw',library:'Will van Wingerden, https://unsplash.com/photos/dsvJgiBJTOs',lake:'Dmitry Sumskoy, https://unsplash.com/photos/YtYdNGabzFo',desk:'Alejandro Escamilla, https://unsplash.com/photos/1SAnrIxw5OY'};
const plan=[];
function txt(s,v,x,y,w,h,size=28,color=C.ink,bold=false){const o=s.shapes.add({geometry:'textbox',name:v.slice(0,70),position:{left:x,top:y,width:w,height:h},fill:'none',line:{fill:'none',width:0}});o.text=v;o.text.style={typeface:'Arial',fontSize:size,color,bold,verticalAlignment:'top'};o.text.insets=0;return o;}
async function img(s,n,x=0,y=0,w=1280,h=720){const b=await fs.readFile(dir+'/assets/'+n+'.jpg');s.images.add({blob:b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength),contentType:'image/jpeg',alt:'Фоновая фотография: '+n,fit:'cover',position:{left:x,top:y,width:w,height:h}});}
async function base(title,{photo=null,dark=false,split=false}={}){const s=P.slides.add();s.background.fill=dark?C.night:C.bg;s._photo=photo;s._dark=dark;
if(photo){if(split)await img(s,photo,866,0,414,720);else{await img(s,photo);s.shapes.add({geometry:'rect',position:{left:0,top:0,width:1280,height:720},fill:'linear(0deg, #082B30/88 0%, #082B30/61 100%)',line:{fill:'none',width:0}});s._dark=true;}}
if(title)txt(s,title,64,55,split?770:1152,118,48,s._dark?C.white:C.ink,true);
txt(s,String(P.slides.items.length).padStart(2,'0'),1192,666,40,25,17,s._dark?C.mint:C.mute);return s;}
function note(s,title,speaker,seconds,speech,sources,visual){s.speakerNotes.text=`${speaker}. ${seconds} секунд.\n${speech}\n\nИсточники: ${sources}\n${s._photo?'Фото: '+photos[s._photo]:''}`;plan.push({n:plan.length+1,title,speaker,seconds,speech,visual});}
function label(s,a,b,x,y,w=510){txt(s,a,x,y,w,50,32,s._dark?C.mint:C.teal,true);txt(s,b,x,y+62,w,106,27,s._dark?'#E5EFEC':C.mute);}
function table(s,values,{x=64,y=210,w=1152,h=360,widths=[320,832],size=25}={}){const t=s.tables.add({rows:values.length,columns:values[0].length,left:x,top:y,width:w,height:h,columnWidths:widths,values});for(let r=0;r<values.length;r++)for(let c=0;c<values[0].length;c++){const cell=t.getCell(r,c);cell.fill=r===0?C.teal:r%2===0?'#E5EBE5':C.bg;cell.text.style={typeface:'Arial',fontSize:size,color:r===0?C.white:C.ink,bold:r===0||c===0};}t.borders.assign({fill:'#CCD8D1',width:1});return t;}
let s=await base('',{photo:'almaty'});
txt(s,'ADAL AI',64,170,1100,150,118,C.white,true);
txt(s,'ИИ-помощник по официальной\nинформации Казахстана',70,344,1020,130,43,C.white);
txt(s,'Бахтияр и Эмиль',70,576,900,50,29,C.mint,true);
note(s,'Adal AI','Бахтияр',20,'Мы создаём помощника по официальной информации Казахстана. Его ключевая идея: объяснять документы понятным языком и проверять ответ перед показом. Сегодня представим команду, устройство системы и стоимость запроса.','README.md; роли команды подтверждены пользователем.','Фото Алматы на весь экран, крупное название');

s=await base('Почему нужен Adal AI',{photo:'library',split:true});
label(s,'Документ найти недостаточно','Нужно понять формулировки,\nусловия и действующую редакцию.',64,215,730);
label(s,'Ошибка может изменить смысл','Уверенный текст ИИ ещё не означает,\nчто вывод подтверждён источником.',64,414,730);
note(s,'Задача продукта','Бахтияр',30,'Пользователю нужно разобраться в официальных материалах. Сложность возникает не только при поиске: важно сохранить условия и исключения. Поэтому мы строим помощника с проверкой опоры на документы. Это постановка задачи, а не измерение распространённости ошибок.','backend/app/prompts.py; backend/README.md.','Светлый фон и вертикальная фотография библиотеки');

s=await base('Команда из двух человек',{photo:'desk'});
txt(s,'Бахтияр',64,244,550,80,64,C.white,true);txt(s,'ИИ-инженер',68,335,530,50,32,C.mint,true);
txt(s,'Модели и поиск по документам\nПроверка ответов и серверная логика',68,421,520,130,28,C.white);
txt(s,'Эмиль',708,244,510,80,64,C.white,true);txt(s,'Frontend-разработчик',712,335,500,50,32,C.mint,true);
txt(s,'Интерфейс и два языка\nДиалог, источники и удобство работы',712,421,500,130,28,C.white);
note(s,'Команда','Оба',25,'Бахтияр: я отвечаю за ИИ-часть, поиск и проверку ответов. Эмиль: я отвечаю за интерфейс, языки и понятный путь пользователя. Распределение технических зон на слайде предложено для выступления исходя из названных ролей.','Пользователь: Бахтияр, ИИ-инженер; Эмиль, frontend.','Имена одинакового размера, нейтральное фото рабочего места без чужих портретов');

s=await base('Русский и қазақша',{photo:'lake'});
txt(s,'RU',64,214,510,135,106,C.mint,true);txt(s,'KK',705,214,510,135,106,C.mint,true);
txt(s,'«Как найти нужный\nофициальный документ?»',68,375,510,110,35,C.white);
txt(s,'«Қажетті ресми құжатты\nқалай табуға болады?»',708,375,510,110,35,C.white);
txt(s,'Выбор языка интерфейса, ответа и поиска по документам',68,594,1110,50,28,C.white);
note(s,'Два языка','Эмиль',30,'Пользователь выбирает русский или казахский. Интерфейс передаёт язык на сервер. В строгом режиме поиск выбирает фрагменты соответствующего языка, а модель отвечает на нём. Автоопределение тоже есть, но явный выбор надёжнее для коротких и смешанных вопросов. Примеры на слайде иллюстрируют ввод, не являются результатами тестирования.','frontend/adal-ai/frontend/src/i18n/ru.ts; kk.ts; backend/app/retrieval.py; backend/README.md.','Фоновое фото озера, две крупные языковые колонки');

s=await base('Путь вопроса в системе');
label(s,'01  Интерфейс','React принимает вопрос\nи выбранный язык.',64,210);
label(s,'02  Сервер','FastAPI запускает поиск\nи выбранный режим ответа.',705,210);
label(s,'03  Документы и ИИ','BM25 находит фрагменты.\nМодель формулирует ответ.',64,420);
label(s,'04  Результат','В строгом режиме ответ выходит\nтолько после всех проверок.',705,420);
note(s,'Архитектура','Бахтияр',30,'Интерфейс отправляет вопрос в FastAPI. В строгом режиме сервер ищет фрагменты локального корпуса, вызывает генератор и проверяет результат. История браузера хранится отдельно в SQLite. Модели доступны через внешние API. Поиск BM25 работает локально и не является отдельной нейросетью.','README.md; backend/app/web.py; retrieval.py; service.py.','Четыре открытых текстовых блока с крупной нумерацией');

s=await base('Официальные источники',{photo:'library'});
txt(s,'37',64,220,500,165,140,C.mint,true);
txt(s,'источников в каталоге',70,400,650,60,38,C.white,true);
txt(s,'«Әділет» и Акорда\nСсылка, редакция и дата проверки\nПросмотр документа перед активацией',732,238,484,250,31,C.white);
txt(s,'В ответ попадают до 5 фрагментов, всего до 30 000 символов',70,589,1120,58,28,C.white);
note(s,'База знаний','Бахтияр',30,'Встроенный каталог содержит 37 официальных источников. Это количество записей каталога, а не гарантия, что все документы активированы или охватывают всё право. Сначала команда проверяет материал, затем включает в поиск. BM25 учитывает слова запроса, русские основы слов и небольшой словарь RU/KK. Во время ответа нет произвольного поиска по всему интернету.','backend/app/catalog.py; collector.py; library.py; retrieval.py; config.py.','Крупная цифра на фотографии библиотеки');

s=await base('Какие ИИ мы подключаем');
table(s,[['Компонент','Задача'],['DeepSeek','Обычный чат или генерация ответа по документам'],['Gemini','Альтернативный генератор и расшифровка аудио'],['Google Check Grounding','Оценка опоры утверждений на найденные тексты'],['Модель-критик','Отдельный вызов для проверки смысла и условий']],{y:210,h:350,widths:[380,772],size:25});
txt(s,'DeepSeek по умолчанию: deepseek-flash. Gemini и критик задаются в настройках.',66,594,1130,70,25,C.mute);
note(s,'Роли ИИ','Бахтияр',40,'DeepSeek используется для чата и может быть генератором в строгой цепочке. Gemini подключён как другой генератор и для аудио. Google Check Grounding оценивает подтверждённость текста. Критик получает вопрос, ответ и документы отдельным запросом. Важно: это роли, а не четыре обязательно разных нейросети. Версии Gemini и критика конфигурируются. Использование одной модели для разных ролей не делает ошибки независимыми.','backend/app/config.py; providers.py; audio.py; direct_chat.py.','Редактируемая таблица ролей моделей');

s=await base('Защита от неточных ответов',{photo:'desk'});
label(s,'01  Проверка кодом','Настоящие цитаты, ID источников,\nчисла и запрет выдуманных ссылок.',64,210);
label(s,'02  Google Grounding','Опора всего ответа\nи каждого утверждения на текст.',705,210);
label(s,'03  Модель-критик','Смысл, отрицания, условия,\nисключения и ответ на вопрос.',64,425);
label(s,'04  Решение сервера','Показ, одна новая попытка\nили отказ от ответа.',705,425);
note(s,'Механизм защиты','Бахтияр',40,'После генерации сначала работают детерминированные проверки. Google проверяет весь ответ и его утверждения. Затем критик оценивает соответствие вопросу и сохранность условий. Непрошедший текст не попадает пользователю. При отклонении возможна одна новая генерация с кодами ошибок, и проверки запускаются заново. При недоступности проверяющего сервиса система возвращает технический отказ.','backend/app/verification.py; service.py; prompts.py.','Четыре последовательных этапа на приглушённом фото');

s=await base('Баллы ответа и критерии допуска');
txt(s,'≥ 0,95',64,219,550,124,95,C.teal,true);txt(s,'оценка всего ответа',68,355,530,60,32,C.ink,true);
txt(s,'≥ 0,95',705,219,510,124,95,C.teal,true);txt(s,'каждое утверждение',709,355,510,60,32,C.ink,true);
txt(s,'Все этапы должны пройти проверку',68,467,1100,60,36,C.ink,true);
txt(s,'Высокий балл не перекрывает ошибку цитаты или отказ критика.\nЭто оценка подтверждённости, а не 95% точности.',68,555,1110,85,27,C.mute);
note(s,'Балльная система','Бахтияр',40,'Под наградой мы понимаем положительную оценку ответа за соблюдение критериев. В текущем коде нет накопительных наград и обучения модели через reinforcement learning. Есть числовые оценки Google и обязательные статусы остальных этапов. Порог 0,95 действует для всего ответа и каждого утверждения. Складывать баллы так, чтобы один успех перекрыл провал, система не позволяет. Порог подбора цитат 0,8 выполняет другую задачу. Пороги требуют калибровки на размеченных вопросах RU/KK.','Пояснение пользователя; backend/app/config.py; verification.py; main.py.','Две крупные оценки и единое правило допуска');

s=await base('Когда подтверждения нет',{photo:'lake'});
txt(s,'«Я не могу подтвердить ответ.\nУточните вопрос или обратитесь\nк помощнику»',66,211,1120,190,47,C.white,true);
txt(s,'+7 706 725 7286',70,449,1090,100,74,C.mint,true);
txt(s,'Сценарий развития: добавить контакт к существующему отказу',70,594,1120,58,26,C.white);
note(s,'Отказ и помощь человека','Эмиль',30,'Если надёжного подтверждения нет, лучше прямо сказать об этом. Сейчас строгий режим уже возвращает сообщение о недостаточности материалов и предлагает уточнить вопрос. На слайде целевой вариант текста с подтверждённым пользователем номером помощника. Автоматическое добавление телефона пока не реализовано в коде. Сам звонок или передача переписки не происходят автоматически.','backend/app/service.py: MESSAGES; номер и назначение подтверждены пользователем в этом чате.','Крупная фраза отказа и номер телефона на фото озера');

s=await base('Отличие в устройстве ответа');
table(s,[['Критерий','Чат без проверки','Adal AI: строгий режим'],['Основа ответа','Контекст модели','Подготовленные документы'],['Проверка цитат','Не обязательна','Код сверяет с источниками'],['Проверка смысла','Нет отдельного этапа','Grounding и модель-критик'],['Недостаточно данных','Зависит от генератора','Сервер блокирует ответ']],{y:210,h:360,widths:[310,370,472],size:24});
txt(s,'Сравнение подходов. Измеренное превосходство над конкретными сервисами пока не заявляем.',66,597,1120,66,24,C.mute);
note(s,'Отличие от других подходов','Бахтияр',30,'Мы сравниваем архитектуру с простым чатом без обязательной проверки. В нашей строгой цепочке контроль встроен в сервер, а решение о показе не остаётся только генератору. Мы не утверждаем, что никто другой так не делает, и не заявляем победу над конкретным конкурентом без тестов. Проверки предназначены для снижения риска ошибок, но не дают абсолютной гарантии.','backend/app/service.py; verification.py; direct_chat.py.','Таблица с сопоставлением по четырём критериям');

s=await base('Backend: Python и FastAPI',{photo:'desk',split:true});
label(s,'API и контракты','FastAPI, Uvicorn, Pydantic\nи pydantic-settings',64,200,730);
label(s,'Модели и документы','HTTPX, google-auth, pypdf,\npython-docx, BeautifulSoup и lxml',64,385,730);
txt(s,'SnowballStemmer для поиска. PyAV для аудио.\nSQLite хранит историю, JSONL хранит корпус.',66,590,738,72,25,C.mute);
note(s,'Основные библиотеки backend','Бахтияр',30,'Backend написан на Python. FastAPI принимает запросы, Uvicorn запускает сервер. Pydantic проверяет структуры данных, pydantic-settings загружает настройки. HTTPX вызывает модели, google-auth нужен для Google Cloud. Парсеры извлекают текст документов. SnowballStemmer помогает русскому поиску, PyAV проверяет аудио. SQLite входит в стандартную библиотеку Python. Pydantic импортируется кодом и приходит через зависимости FastAPI и pydantic-settings.','backend/pyproject.toml; backend/app/providers.py; parsing.py; audio.py; web.py.','Светлый технический слайд с фото рабочего места справа');

s=await base('Frontend: React и TypeScript');
label(s,'React + React DOM','Диалог, история, источники\nи переключение языка.',64,214);
label(s,'TypeScript + Vite','Типизация данных\nи сборка веб-приложения.',705,214);
label(s,'react-markdown + remark-gfm','Отображение форматированного\nответа с ограничением ссылок.',64,429);
label(s,'Vite PWA + Workbox','Установка как приложения.\nКэшируется статика интерфейса.',705,429);
note(s,'Основные библиотеки frontend','Эмиль',30,'React управляет интерфейсом. TypeScript помогает соблюдать контракт API. Markdown-библиотеки отображают ответы, а компонент SafeMarkdown контролирует ссылки. Vite собирает проект. PWA позволяет установить интерфейс, но ИИ требует сеть: ответы API не кэшируются для офлайн-работы. Для тестирования есть Vitest и Testing Library, для проверки кода ESLint.','frontend/adal-ai/frontend/package.json; vite.config.ts; src/components/SafeMarkdown.tsx.','Четыре открытых блока библиотек по задачам');

s=await base('Математика одного запроса');
txt(s,'Цена = токены × тариф + проверки',64,188,1150,67,42,C.teal,true);
table(s,[['Расчётный сценарий','Вход / выход','Цена LLM'],['Обычный чат','2 000 / 200 токенов','$0,00042'],['Генератор','6 000 / 600 токенов','$0,00126'],['Критик','6 800 / 400 токенов','$0,00126'],['Строгий цикл','12 800 / 1 000 суммарно','$0,00252 + G']],{y:282,h:292,widths:[440,375,337],size:24});
txt(s,'Допущения: оба вызова deepseek-flash, вне пика, без кэша.\nТариф за 1 млн токенов: $0,15 вход / $0,60 выход. G = Google Check Grounding.',66,602,1135,69,23,C.mute);
note(s,'Цена одного запроса','Бахтияр',45,'Это модель затрат, а не измеренный расход приложения. Общая формула: сумма входных токенов, умноженных на входной тариф, и выходных токенов, умноженных на выходной тариф, делённая на миллион, плюс проверка Google. Для обычного чата: (2000 × 0,15 + 200 × 0,60) / 1000000 = 0,00042 доллара. Для генератора 0,00126, для критика 0,00126. Оба вызова условно используют deepseek-flash. Вход включает инструкции и документы, выход должен учитывать все оплачиваемые токены, включая рассуждения. Реальные размеры, модель критика, кэш и время суток меняют цену. На 16.10.2026 peak тарифы DeepSeek вдвое выше.','https://api-docs.deepseek.com/quick_start/pricing/ ; проверено 16.10.2026. backend/app/providers.py; config.py.','Редактируемая таблица с прозрачными исходными числами');

s=await base('Полная себестоимость',{photo:'desk'});
txt(s,'≈ $0,00377',64,211,1100,132,96,C.mint,true);
txt(s,'за запрос в условном сценарии',70,354,1100,60,36,C.white);
txt(s,'$0,00252075 × 1,10 + $10 / 10 000',70,453,1110,64,43,C.white,true);
txt(s,'10% полных повторов. $10 в месяц на инфраструктуру.\n10 000 запросов в месяц. Без аудио и труда команды.',70,568,1100,92,27,C.white);
note(s,'Повторы и инфраструктура','Бахтияр',35,'На странице Google Cloud Check Grounding указан базовый тариф 0,00075 доллара за 1000 count. Поэтому G = 0,00000075 доллара за проверку. Один цикл в нашем сценарии: 0,00252 + G = 0,00252075. Если 10 процентов запросов полностью повторяют цикл, средняя переменная стоимость равна 0,002772825. Добавим условные 10 долларов инфраструктуры на 10000 запросов: итог 0,003772825 доллара. Это допущения, не счёт Railway и не измеренная доля повторов. Для пикового тарифа DeepSeek аналогичный итог 0,006544825 доллара. Перевод в тенге: умножить долларовую стоимость на фактический курс оплаты. Аудио Gemini, налоги, комиссии, обслуживание корпуса и работа команды отдельно. Фактическая цена проверяется по биллингу. Ранний отказ может сократить число вызовов.','https://cloud.google.com/generative-ai-app-builder/pricing#check_grounding_api_pricing ; https://api-docs.deepseek.com/quick_start/pricing/ ; проверено 16.10.2026. Расчётные допущения явно указаны на слайде.','Крупная итоговая цена и формула на фото');

s=await base('Два режима и готовность системы');
label(s,'Обычный чат DeepSeek','Ответ без проверки по корпусу.\nПользователь видит предупреждение.',64,212);
label(s,'Строгий режим','Поиск, цитаты, Grounding и критик.\nНужны активные документы и API.',705,212);
txt(s,'Следующий шаг',64,442,1100,55,35,C.teal,true);
txt(s,'Оценить ошибки и отказы на отдельных наборах RU/KK,\nнастроить пороги и добавить контакт помощника.',68,517,1120,110,32,C.ink);
note(s,'Честное состояние проекта','Бахтияр',35,'В README опубликованный сайт указан как работающий в режиме deepseek. У него нет строгой проверки по документам. Строгий путь реализован отдельно и требует настройки Google Cloud, критика и активированного корпуса. Текущую конфигурацию развёртывания перед выступлением нужно сверить. Не следует показывать ответ обычного режима как прошедший все проверки. Дальнейшая работа: экспертная разметка вопросов, измерение ошибок среди показанных ответов и доли отказов отдельно по языкам, настройка порогов. Контакт помощника добавляется к отказу как следующий шаг.','README.md раздел Railway; backend/app/direct_chat.py; service.py; main.py.','Две колонки режимов и конкретные ближайшие шаги');

s=await base('',{photo:'almaty'});
txt(s,'Понятный ответ.\nПроверяемый источник.',64,157,1160,220,72,C.white,true);
txt(s,'ADAL AI',70,428,1100,70,48,C.mint,true);
txt(s,'Бахтияр и Эмиль\nСвязь с помощником: +7 706 725 7286',70,555,1100,92,29,C.white);
note(s,'Завершение','Оба',20,'Бахтияр: наша цель состоит в том, чтобы каждый показанный ответ имел опору на официальные материалы. Эмиль: пользователь получает понятный интерфейс на двух языках и возможность обратиться за помощью. Мы готовы показать устройство проекта и ответить на вопросы.','Содержание проекта и подтверждённый пользователем контакт.','Фотография Алматы, крупная финальная мысль и контакт');

s=await base('Приложение: зависимости backend');
table(s,[['Группа','Прямые зависимости из pyproject.toml'],['Сервер','fastapi, uvicorn, python-multipart'],['API и настройки','httpx, pydantic-settings, google-auth[requests]'],['Поиск','snowballstemmer'],['Документы','beautifulsoup4, lxml, pypdf, python-docx'],['Аудио','av'],['Разработка','pytest, pytest-asyncio, ruff']],{y:196,h:409,widths:[310,842],size:24});
txt(s,'Pydantic импортируется кодом. sqlite3, asyncio и json входят в Python.',66,634,1130,40,23,C.mute);
note(s,'Полный список прямых зависимостей backend','Бахтияр',0,'Резерв для технических вопросов. Здесь перечислены все 12 прямых runtime-зависимостей и три dev-зависимости из pyproject.toml. Pydantic используется напрямую в коде, но отдельно в этом манифесте не объявлен. Транзитивное дерево содержится в requirements.lock. Это не список всех транзитивных пакетов.','backend/pyproject.toml; backend/requirements.lock.','Редактируемая таблица полного списка прямых зависимостей');

s=await base('Приложение: зависимости frontend');
const rows=[['Группа','Пакеты из package.json'],['Runtime','react, react-dom, react-markdown, remark-gfm'],['Сборка и PWA','typescript, vite, @vitejs/plugin-react, vite-plugin-pwa,\n@vite-pwa/assets-generator, workbox-build, workbox-window'],['Проверка кода','eslint, @eslint/js, typescript-eslint, globals,\neslint-plugin-react-hooks, eslint-plugin-react-refresh'],['Тесты','vitest, jsdom, @testing-library/dom, @testing-library/react,\n@testing-library/jest-dom, @testing-library/user-event'],['Типы','@types/node, @types/react, @types/react-dom']];
table(s,rows,{y:194,h:443,widths:[290,862],size:23});
note(s,'Полный список прямых зависимостей frontend','Эмиль',0,'Резерв для технических вопросов. На слайде все четыре runtime-зависимости и все 22 dev-зависимости package.json. Версии и краткое назначение сохранены в плане. Транзитивные пакеты не перечисляются.','frontend/adal-ai/frontend/package.json.','Редактируемая таблица runtime и инструментов разработки');

await fs.writeFile(dir+'/plan.json',JSON.stringify(plan,null,2));
let md='# План выступления Adal AI\n\n19 слайдов: 17 основных и 2 технических приложения. Основная часть около '+Math.round(plan.reduce((a,b)=>a+b.seconds,0)/60)+' минут. Презентация на русском, продукт на русском и казахском. Фото служат фоном, скриншотов сервиса нет.\n\n';
md+='## Распределение ролей\n\nБахтияр представляет ИИ, сервер, проверки и экономику. Эмиль объясняет интерфейс, языки и сценарий помощи. На слайде команды оба представляются по очереди. Имена имеют одинаковый визуальный вес. Фото посторонних людей не используются как портреты участников.\n\n';
md+='## Последовательность\n\n| № | Слайд | Кто | Время | Как показать |\n|---|---|---|---|---|\n';
for(const p of plan)md+=`| ${p.n} | ${p.title} | ${p.speaker} | ${p.seconds?p.seconds+' с':'резерв'} | ${p.visual} |\n`;
md+='\n## Текст выступления\n\n';for(const p of plan)md+=`### ${p.n}. ${p.title}\n\n${p.speech}\n\n`;
md+='## Расчёт цены\n\nТариф DeepSeek Flash вне пика: $0,15 за 1 млн входных токенов без кэша и $0,60 за 1 млн выходных. В пик $0,30 и $1,20. Тарифы проверены 16 октября 2026: https://api-docs.deepseek.com/quick_start/pricing/ .\n\nC = (Tin × Pin + Tout × Pout) / 1 000 000 + G.\n\n- Обычный чат: (2000 × 0,15 + 200 × 0,60) / 1 000 000 = $0,00042.\n- Генератор: (6000 × 0,15 + 600 × 0,60) / 1 000 000 = $0,00126.\n- Критик: (6800 × 0,15 + 400 × 0,60) / 1 000 000 = $0,00126.\n- Check Grounding: на опубликованной таблице $0,00075 / 1000 count, то есть G = $0,00000075. Источник: https://cloud.google.com/generative-ai-app-builder/pricing#check_grounding_api_pricing .\n- Цикл: $0,00252075. Два полных цикла: $0,00504150.\n- При 10% полных повторов: $0,00252075 × 1,10 = $0,002772825.\n- При условных $10 инфраструктуры / 10000 запросов: $0,003772825 за запрос, около $37,73 за 10000 запросов.\n- В пик при тех же условиях: $0,006544825 за запрос.\n\nЭто сценарий, а не измерение. Не включены аудио, налоги, комиссии, работа команды и обслуживание документов. Модель критика в примере совпадает с генератором только для расчёта. Реальная модель, все оплачиваемые токены, кэш и число выполненных этапов меняют стоимость. Для тенге умножить на фактический курс оплаты.\n\n';
md+='## Полный список прямых библиотек\n\nBackend: см. pyproject.toml. Runtime: fastapi, uvicorn, httpx, pydantic-settings, google-auth[requests], snowballstemmer, python-multipart, beautifulsoup4, lxml, pypdf, python-docx, av. Dev: pytest, pytest-asyncio, ruff. Pydantic используется в коде и установлен через зависимости. SQLite входит в Python.\n\nFrontend:\n\n';
const pkg=JSON.parse(await fs.readFile(root+'/frontend/adal-ai/frontend/package.json','utf8'));for(const key of ['dependencies','devDependencies']){md+='### '+key+'\n\n';for(const [k,v] of Object.entries(pkg[key]))md+=`- ${k}: ${v}\n`;md+='\n';}
md+='## Важные границы утверждений\n\n- Баллы относятся к подтверждённости ответа. Накопительных наград и обучения через RL в коде нет.\n- 0,95 не равно 95% достоверности. Все этапы обязательны.\n- Номер +7 706 725 7286 подтверждён пользователем как контакт помощника. Его автоматическое включение в ответ пока является сценарием развития.\n- Согласно README, сайт использует обычный режим DeepSeek. Защита по документам относится к отдельному строгому режиму.\n- 37 означает записи каталога, не число действующих законов и не число активированных документов.\n- Качество RU/KK и превосходство над конкурентами пока не измерены.\n\n## Фото\n\n';for(const [k,v]of Object.entries(photos))md+=`- ${k}: ${v}\n`;
await fs.writeFile(root+'/output/Adal_AI_план_выступления.md',md);
await (await PresentationFile.exportPptx(P)).save(dir+'/draft.pptx');
for(let i=0;i<P.slides.items.length;i++){const b=await P.export({slide:P.slides.items[i],format:'png',scale:1});await fs.writeFile(dir+`/renders/slide-${String(i+1).padStart(2,'0')}.png`,new Uint8Array(await b.arrayBuffer()));console.log('Rendered '+(i+1));}
const result=await finalizePresentation({workspaceDir:root,candidatePath:dir+'/draft.pptx',finalPath:root+'/output/Adal_AI_презентация_с_фото.pptx',pythonExecutable:'/Users/abulkasimovbakhtiyar/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3',integrityValidatorPath:sk+'/container_tools/inspect_presentation_package_integrity.py',layoutValidatorPath:sk+'/container_tools/inspect_presentation_layout_geometry.py',layoutArgs:['--expected-slide-size-emu','12192000,6858000','--validate-heading-fit',...[7,11,14,18,19].flatMap(n=>['--require-native-table-slide',String(n)])],requiredNativeTableOwnerSlides:[7,11,14,18,19],fontPolicy:{basis:'design',families:['Arial']},verifyArtifactToolImport:true,receiptPath:dir+'/validation.json'});console.log(JSON.stringify(result));
