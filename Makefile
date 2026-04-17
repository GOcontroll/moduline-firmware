DESTDIR?=/

install:
	@install -Dm644 -t $(DESTDIR)/lib/firmware/brcm/ firmware/brcm/*
